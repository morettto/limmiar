"""Bakeoff de juízes de relevância sobre o gabarito por construção, isolado da busca.

Cada fala desenhada (positiva e negativa) é julgada contra o pool fixo da sua sessão: as 10 âncoras mais 2 candidatos
sorteados de cada um dos 5 materiais. Só (positivo, sua âncora) é par positivo.

Uso: bakeoff_juiz.py --juizes bge-m3 ... [--alunos PASTA ...] [--dados DIR] [--saida DIR] [--dispositivo cpu|cuda]
[--threads N] [--baixar]. Cada pasta de --alunos vira o juiz aluno-<nome da pasta>; um aluno gte carrega pelo
copiloto.aluno de produção. O juiz producao é o professor da cascata, servido pelo juiz_llm de produção.
DIR de dados tem sessoes/, passagens/ e candidatos/ (gabarito já validado por validar_gold.py). Notas em <saida>/<juiz>.jsonl
(reaproveitadas), medidas em <juiz>.meta.json, resumo de todo juiz completo em resumo.json e resumo.md.
Rode um juiz por processo: rss_pico_mb é o pico do processo. Depende só de torch, transformers, peft,
sentence-transformers, scikit-learn e numpy.
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'mvp-copiloto' / 'src'))
from copiloto import aluno  # noqa: E402

GOLD = ROOT / '.local' / 'claude-goal' / 'gold'
BAKEOFF = GOLD / 'bakeoff'
JUIZ_ENV = ROOT / '.local' / 'simulacao-100' / 'judge-env.json'
NEGATIVOS = ('conversa', 'logistica', 'terceiro', 'negacao', 'figurado', 'nega_risco')
SEMENTE = 20261020
EXTRAS_POR_MATERIAL = 2
ALVO_PRECISAO = 0.95
GRUPOS_NEGATIVOS = ('mesmo_material', 'outro_material', 'fala_negativa')
Z95 = 1.959964
DISPOSITIVO = 'cpu'

Juiz = Callable[[str, list[str]], list[float]]
Carregar = Callable[[], tuple[Juiz, int | None]]
SessaoPool = tuple[list[dict], list[dict]]


class Bloqueado(Exception):
    pass


def ler(caminho: Path) -> list[dict]:
    if not caminho.exists():
        return []
    return [json.loads(linha) for linha in caminho.read_text(encoding='utf-8').splitlines() if linha.strip()]


def wilson(acertos: int, total: int) -> dict:
    if total == 0:
        return {'k': 0, 'n': 0, 'taxa': None, 'ic95': None}
    p = acertos / total
    base = 1 + Z95 ** 2 / total
    centro = (p + Z95 ** 2 / (2 * total)) / base
    margem = Z95 * math.sqrt(p * (1 - p) / total + Z95 ** 2 / (4 * total ** 2)) / base
    return {'k': acertos, 'n': total, 'taxa': round(p, 4), 'ic95': [round(centro - margem, 4), round(centro + margem, 4)]}


def montar_pool(gold: list[dict], contexto: dict, passagens: dict[str, dict], semente: int = SEMENTE) -> list[dict]:
    ancoras = list(dict.fromkeys(r['ancora']['trecho_id'] for r in gold if r['tipo'] == 'positivo'))
    sorteio = random.Random(f'{semente}:{contexto["sessao"]}')
    extras = []
    for material in contexto['materiais']:
        livres = [p['trecho_id'] for p in material['passagens'] if p['trecho_id'] not in ancoras]
        extras += sorteio.sample(livres, EXTRAS_POR_MATERIAL)
    return [passagens[t] for t in ancoras + extras]


def grupo(fala: dict, trecho: dict) -> str:
    if fala['tipo'] != 'positivo':
        return 'fala_negativa'
    ancora = fala['ancora']
    if trecho['trecho_id'] == ancora['trecho_id']:
        return 'ancora'
    return 'mesmo_material' if trecho['pmcid'] == ancora['pmcid'] else 'outro_material'


def pares(fala: dict, pool: list[dict]) -> list[dict]:
    return [{'sessao': fala['sessao'], 'id': fala['id'], 'tipo': fala['tipo'], 'subtipo': fala['subtipo'],
             'trecho_id': t['trecho_id'], 'grupo': (g := grupo(fala, t)), 'rotulo': int(g == 'ancora')} for t in pool]


def _chave(fala: dict, pool: list[dict]) -> tuple:
    return fala['sessao'], fala['id'], tuple(t['trecho_id'] for t in pool)


def _em_cache(caminho: Path, sessoes: list[SessaoPool]) -> tuple[dict, list[tuple[dict, list[dict]]]]:
    feitos = {(r['sessao'], r['id'], tuple(r['trechos'])): r['notas'] for r in ler(caminho)}
    pendentes = [(fala, pool) for gold, pool in sessoes for fala in gold if _chave(fala, pool) not in feitos]
    return feitos, pendentes


def _com_notas(feitos: dict, sessoes: list[SessaoPool]) -> list[dict]:
    return [par | {'nota': nota} for gold, pool in sessoes for fala in gold
            for par, nota in zip(pares(fala, pool), feitos[_chave(fala, pool)], strict=True)]


def _memoria_pico_mb() -> dict:
    try:
        import resource  # Linux reports ru_maxrss in KiB
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    except ImportError:
        import psutil
        info = psutil.Process().memory_info()
        rss = getattr(info, 'peak_wset', info.rss) / 2 ** 20
    saida = {'rss_pico_mb': round(rss, 1)}
    if DISPOSITIVO == 'cuda':
        import torch
        saida['vram_pico_mb'] = round(torch.cuda.max_memory_allocated() / 2 ** 20, 1)
    return saida


def pontuar(nome: str, carregar: Carregar, sessoes: list[SessaoPool], pasta: Path = BAKEOFF) -> list[dict]:
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / f'{nome}.jsonl'
    feitos, pendentes = _em_cache(caminho, sessoes)
    if not pendentes:
        return _com_notas(feitos, sessoes)
    inicio = time.perf_counter()
    try:
        juiz, parametros = carregar()
    except Bloqueado:
        raise
    except Exception as erro:  # noqa: BLE001 - any load failure (absent from cache, wrong head) blocks this judge only
        raise Bloqueado(f'{type(erro).__name__}: {str(erro).splitlines()[0][:300]}') from erro
    carga_s, gasto, medidos = time.perf_counter() - inicio, 0.0, 0
    with caminho.open('a', encoding='utf-8') as arquivo:
        for i, (fala, pool) in enumerate(pendentes):
            antes = time.perf_counter()
            notas = [float(n) for n in juiz(fala['frase'], [t['texto'] for t in pool])]
            if len(notas) != len(pool) or not all(map(math.isfinite, notas)):
                raise ValueError(f'{nome}: notas inválidas para {fala["id"]}')
            if i or len(pendentes) == 1:  # the first call carries lazy init, so it is left out of ms_por_par
                gasto, medidos = gasto + time.perf_counter() - antes, medidos + len(pool)
            arquivo.write(json.dumps({'sessao': fala['sessao'], 'id': fala['id'], 'trechos': [t['trecho_id'] for t in pool],
                                      'notas': notas}) + '\n')
            arquivo.flush()
            feitos[_chave(fala, pool)] = notas
    (pasta / f'{nome}.meta.json').write_text(json.dumps({
        'ms_por_par': round(1000 * gasto / medidos, 2), 'pares_medidos': medidos, 'carga_s': round(carga_s, 1),
        'parametros': parametros} | _memoria_pico_mb(), indent=1), encoding='utf-8')
    del juiz
    gc.collect()
    return _com_notas(feitos, sessoes)


def limiar(falas: list[dict], alvo: float = ALVO_PRECISAO) -> float:
    """Lowest top-passage score whose shown cards keep precision >= alvo; inf (never show) when no score does."""
    ordem = sorted(falas, key=lambda f: -f['nota'])
    melhor, certos_melhor, certos = math.inf, 0, 0
    for i, fala in enumerate(ordem):
        certos += fala['acerto']
        if i + 1 < len(ordem) and ordem[i + 1]['nota'] == fala['nota']:
            continue
        if certos / (i + 1) >= alvo and certos > certos_melhor:
            melhor, certos_melhor = fala['nota'], certos
    return melhor


def topos(pares_: list[dict]) -> list[dict]:
    por_fala = defaultdict(list)
    for par in pares_:
        por_fala[par['sessao'], par['id']].append(par)
    falas = []
    for itens in por_fala.values():
        topo = max(itens, key=lambda p: p['nota'])
        falas.append({k: topo[k] for k in ('sessao', 'id', 'tipo', 'subtipo', 'nota')} | {'acerto': topo['rotulo'] == 1})
    return falas


def ece(p: np.ndarray, y: np.ndarray, faixas: int = 10) -> float:
    p = np.clip(p, 0, 1)
    indice = np.minimum((p * faixas).astype(int), faixas - 1)
    soma = sum(abs(p[m].mean() - y[m].mean()) * m.sum() for b in range(faixas) if (m := indice == b).any())
    return round(float(soma / len(p)), 4)


def _auroc(y: np.ndarray, s: np.ndarray) -> float | None:
    from sklearn.metrics import roc_auc_score

    return round(float(roc_auc_score(y, s)), 4) if 0 < y.sum() < len(y) else None


def metricas(pares_: list[dict], alvo: float = ALVO_PRECISAO) -> dict:
    from sklearn.isotonic import IsotonicRegression

    y = np.array([p['rotulo'] for p in pares_])
    s = np.array([p['nota'] for p in pares_], dtype=float)
    grupos = np.array([p['grupo'] for p in pares_])
    sessao_par = np.array([p['sessao'] for p in pares_])
    calibrado = np.empty_like(s)
    for sessao in set(sessao_par):
        fora = sessao_par != sessao
        modelo = IsotonicRegression(y_min=0, y_max=1, out_of_bounds='clip').fit(s[fora], y[fora])
        calibrado[~fora] = modelo.predict(s[~fora])

    falas = topos(pares_)
    limiares = {sessao: limiar([f for f in falas if f['sessao'] != sessao], alvo) for sessao in sorted(set(sessao_par))}
    for fala in falas:
        fala['mostra'] = fala['nota'] >= limiares[fala['sessao']]
    positivos = [f for f in falas if f['tipo'] == 'positivo']
    negativos = [f for f in falas if f['tipo'] == 'negativo']
    return {
        'pares': len(pares_), 'falas': len(falas),
        'auroc': _auroc(y, s),
        'auroc_por_grupo': {g: _auroc(y[m], s[m]) for g in GRUPOS_NEGATIVOS if (m := (y == 1) | (grupos == g)).any()},
        'acerto_topo_sem_limiar': wilson(sum(f['acerto'] for f in positivos), len(positivos)),
        'recall': wilson(sum(f['mostra'] and f['acerto'] for f in positivos), len(positivos)),
        'precisao': wilson(sum(f['mostra'] and f['acerto'] for f in falas), sum(f['mostra'] for f in falas)),
        'cartao_falso': wilson(sum(f['mostra'] for f in negativos), len(negativos)),
        'cartao_falso_por_subtipo': {sub: wilson(sum(f['mostra'] for f in grupo_), len(grupo_))
                                     for sub in NEGATIVOS
                                     if (grupo_ := [f for f in negativos if f['subtipo'] == sub])},
        'limiar_por_sessao': {k: None if math.isinf(v) else round(v, 6) for k, v in limiares.items()},
        'ece_bruto': ece(s, y),
        'ece_isotonico': ece(calibrado, y),
    }


def _parametros(modelo) -> int:
    return sum(p.numel() for p in modelo.parameters())


def _bge_m3() -> tuple[Juiz, int]:
    from sentence_transformers import SentenceTransformer

    modelo = SentenceTransformer('BAAI/bge-m3', device=DISPOSITIVO)
    vetores: dict[str, np.ndarray] = {}

    def codificar(textos: list[str]) -> np.ndarray:
        return modelo.encode(textos, batch_size=32, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)

    def juiz(frase: str, textos: list[str]) -> list[float]:
        # Passages are embedded once, as production does at material prep; per pair only the query is encoded.
        if novos := [t for t in dict.fromkeys(textos) if t not in vetores]:
            vetores.update(zip(novos, codificar(novos)))
        consulta = codificar([frase])[0]
        return [float(vetores[t] @ consulta) for t in textos]

    return juiz, _parametros(modelo)


def _seq_cls(repo: str) -> Carregar:
    def carregar() -> tuple[Juiz, int]:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        tok = AutoTokenizer.from_pretrained(repo, trust_remote_code=True)
        modelo, info = AutoModelForSequenceClassification.from_pretrained(
            repo, trust_remote_code=True, dtype=torch.float32, output_loading_info=True)
        if info['missing_keys']:
            raise Bloqueado(f'{repo} não é um classificador de pares: {len(info["missing_keys"])} pesos iniciados ao acaso')
        if getattr(modelo.config, 'auto_map', None):  # remote-code gte only; native models keep 2-D position_ids
            aluno.reparar(modelo)
        modelo.to(DISPOSITIVO).eval()

        def juiz(frase: str, textos: list[str]) -> list[float]:
            notas = []
            with torch.inference_mode():
                for i in range(0, len(textos), aluno.LOTE):
                    fatia = textos[i:i + aluno.LOTE]
                    enc = tok([frase] * len(fatia), fatia, padding=True, truncation=True, max_length=aluno.MAX_TOKENS,
                              return_tensors='pt')
                    notas += modelo(**enc.to(DISPOSITIVO)).logits[:, 0].float().sigmoid().tolist()
            return notas

        return juiz, _parametros(modelo)

    return carregar


# Qwen3-Reranker's documented yes/no template, with the clinical instruction its LoRA students are trained on.
PREFIXO_QWEN = ('<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct '
                'provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n')
SUFIXO_QWEN = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
INSTRUCAO_QWEN = ("Given a patient's utterance in a therapy session, judge whether the passage describes the same clinical "
                  'phenomenon the patient expresses')


def fonte_hf(repo: str) -> tuple[str, dict]:
    """A repo id or folder as is; a .gguf file as its folder plus gguf_file, which transformers dequantizes on load."""
    caminho = Path(repo)
    return (str(caminho.parent), {'gguf_file': caminho.name}) if caminho.suffix == '.gguf' else (repo, {})


def _qwen3_reranker(repo: str = 'Qwen/Qwen3-Reranker-0.6B', adaptador: str | None = None) -> tuple[Juiz, int]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    fonte, extra = fonte_hf(repo)
    tok = AutoTokenizer.from_pretrained(fonte, padding_side='left', **extra)
    modelo = AutoModelForCausalLM.from_pretrained(fonte, dtype=torch.float32, **extra)
    if adaptador:
        from peft import PeftModel
        modelo = PeftModel.from_pretrained(modelo, adaptador).merge_and_unload()
    modelo = modelo.to(DISPOSITIVO).eval()
    nao, sim = tok.convert_tokens_to_ids('no'), tok.convert_tokens_to_ids('yes')

    def juiz(frase: str, textos: list[str]) -> list[float]:
        notas = []
        with torch.inference_mode():
            for i in range(0, len(textos), aluno.LOTE):
                entradas = [f'{PREFIXO_QWEN}<Instruct>: {INSTRUCAO_QWEN}\n<Query>: {frase}\n<Document>: {t}{SUFIXO_QWEN}'
                            for t in textos[i:i + aluno.LOTE]]
                # No truncation: cutting from the right would drop the assistant suffix the yes/no logit is read after.
                enc = tok(entradas, padding=True, return_tensors='pt').to(DISPOSITIVO)
                notas += modelo(**enc).logits[:, -1, [nao, sim]].float().softmax(-1)[:, 1].tolist()
        return notas

    return juiz, _parametros(modelo)


def _producao() -> tuple[Juiz, None]:
    """The cascade's teacher exactly as production calls it: juiz_llm against the local server judge-env.json names."""
    if not JUIZ_ENV.exists():
        raise Bloqueado(f'{JUIZ_ENV.name} ausente')
    os.environ.update({k: str(v) for k, v in json.loads(JUIZ_ENV.read_text(encoding='utf-8')).items()})
    from copiloto import juiz_llm  # reads its URL and key at import, so only after the env is set
    if not juiz_llm.URL.startswith(('http://127.0.0.1:8100', 'http://localhost:8100')) or not juiz_llm.no_ar():
        raise Bloqueado('servidor do juiz não responde em 127.0.0.1:8100')
    salt = juiz_llm.cache_salt('bakeoff-juiz')
    return (lambda frase, textos: juiz_llm.julgar(frase, textos, cache_salt=salt)), None


def _aluno(pasta: Path) -> Carregar:
    """A LoRA student from treino-juiz/treinar.py; a gte one loads through copiloto.aluno, the loader production uses."""
    if json.loads((pasta / 'treino.json').read_text(encoding='utf-8'))['aluno'] == 'qwen':
        base = json.loads((pasta / 'adapter_config.json').read_text(encoding='utf-8'))['base_model_name_or_path']
        return lambda: _qwen3_reranker(base, str(pasta))
    return lambda: (aluno.carregar(pasta, DISPOSITIVO), None)


JUIZES: dict[str, Carregar] = {
    'bge-m3': _bge_m3,
    'gte-reranker-base': _seq_cls(aluno.BASE),
    'qwen3-reranker-0.6b': _qwen3_reranker,
    'producao': _producao,
}


def carregar_sessoes(dados: Path = GOLD, alvos: list[str] | None = None) -> list[SessaoPool]:
    saida = []
    for caminho in sorted((dados / 'sessoes').glob('sessao-*.jsonl')):
        if alvos is not None and caminho.stem not in alvos:
            continue
        gold = ler(caminho)
        contexto = json.loads((dados / 'candidatos' / f'{caminho.stem}.json').read_text(encoding='utf-8'))
        passagens = {t: row for m in contexto['materiais']
                     for t, row in ((r['trecho_id'], r) for r in ler(dados / 'passagens' / f'{m["pmcid"]}.jsonl'))}
        saida.append((gold, montar_pool(gold, contexto, passagens)))
    return saida


def _taxa(w: dict) -> str:
    return '-' if w['taxa'] is None else f'{w["taxa"]:.3f} ({w["k"]}/{w["n"]})'


def tabela(resumo: dict) -> str:
    linhas = ['| juiz | AUROC | AUROC mesmo material | recall | precisão | cartão falso | ECE bruto | ECE isotônico '
              '| ms/par | RSS pico MB | parâmetros |', '|' + ' --- |' * 11]
    sub = ['', '| juiz | ' + ' | '.join(NEGATIVOS) + ' |', '|' + ' --- |' * (1 + len(NEGATIVOS))]
    for nome, r in resumo.items():
        if 'metricas' not in r:
            motivo = r.get('bloqueado') or f'incompleto: {r["pendentes"]} falas'
            linhas.append(f'| {nome} | {motivo} |' + ' |' * 9)
            continue
        m, meta = r['metricas'], r.get('meta', {})
        linhas.append(f'| {nome} | {m["auroc"]} | {m["auroc_por_grupo"].get("mesmo_material")} | {_taxa(m["recall"])} '
                      f'| {_taxa(m["precisao"])} | {_taxa(m["cartao_falso"])} | {m["ece_bruto"]} | {m["ece_isotonico"]} '
                      f'| {meta.get("ms_por_par")} | {meta.get("rss_pico_mb")} | {meta.get("parametros")} |')
        sub.append(f'| {nome} | ' + ' | '.join(_taxa(m['cartao_falso_por_subtipo'][s]) if s in m['cartao_falso_por_subtipo']
                                             else '-' for s in NEGATIVOS) + ' |')
    return '\n'.join(linhas + sub) + '\n'


def resumir(sessoes: list[SessaoPool], pasta: Path = BAKEOFF) -> dict:
    resumo = {}
    for nome in JUIZES:
        meta_arquivo, cache = pasta / f'{nome}.meta.json', pasta / f'{nome}.jsonl'
        meta = json.loads(meta_arquivo.read_text(encoding='utf-8')) if meta_arquivo.exists() else None
        if meta is None and not cache.exists():
            continue
        feitos, pendentes = _em_cache(cache, sessoes)
        if pendentes:
            resumo[nome] = {'pendentes': len(pendentes)} | ({'bloqueado': meta['bloqueado']} if meta and 'bloqueado' in meta else {})
        else:
            resumo[nome] = {'metricas': metricas(_com_notas(feitos, sessoes)), 'meta': meta or {}}
    return resumo


def main(argv: list[str]) -> int:
    global DISPOSITIVO
    parser = argparse.ArgumentParser()
    parser.add_argument('--juizes', nargs='*', default=[], choices=list(JUIZES))
    parser.add_argument('--sessoes', nargs='*')
    parser.add_argument('--dados', type=Path, default=GOLD)
    parser.add_argument('--saida', type=Path)
    parser.add_argument('--dispositivo', choices=('cpu', 'cuda'), default='cpu')
    parser.add_argument('--threads', type=int)
    parser.add_argument('--baixar', action='store_true', help='permite baixar modelos do Hub; sem ele, só o cache local')
    parser.add_argument('--alunos', nargs='*', type=Path, default=[], help='pastas de alunos de treino-juiz/treinar.py')
    args = parser.parse_args(argv)
    for pasta in args.alunos:
        JUIZES[f'aluno-{pasta.name}'] = _aluno(pasta)
        args.juizes.append(f'aluno-{pasta.name}')
    if not args.baixar:  # read by huggingface_hub at import, and every HF import here is lazy
        os.environ.update({'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'})
    DISPOSITIVO = args.dispositivo
    if args.threads:
        import torch
        torch.set_num_threads(args.threads)
    saida = args.saida or args.dados / 'bakeoff'
    sessoes = carregar_sessoes(args.dados, args.sessoes)
    if not sessoes:
        raise SystemExit(f'nenhuma sessão com gabarito em {args.dados / "sessoes"}')
    print(f'{len(sessoes)} sessões, {sum(len(g) * len(p) for g, p in sessoes)} pares por juiz', flush=True)
    saida.mkdir(parents=True, exist_ok=True)
    for nome in args.juizes:
        try:
            pontuar(nome, JUIZES[nome], sessoes, saida)
            print(f'{nome}: pontuado', flush=True)
        except Bloqueado as motivo:
            (saida / f'{nome}.meta.json').write_text(json.dumps({'bloqueado': str(motivo)}, ensure_ascii=False),
                                                       encoding='utf-8')
            print(f'{nome}: bloqueado ({motivo})', flush=True)
    resumo = resumir(sessoes, saida)
    (saida / 'resumo.json').write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding='utf-8')
    (saida / 'resumo.md').write_text(tabela(resumo), encoding='utf-8')
    print(tabela(resumo))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
