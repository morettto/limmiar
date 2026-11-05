"""Limiar da cascata no gabarito: o aluno escolhe 6 das 20 passagens do pool, o professor julga essas 6 e o cartão sai
quando a margem de logit entre o melhor e o segundo material passa do limiar.

Uso: cascata.py --aluno NOTAS.jsonl --professor NOTAS.jsonl [...] [--julgar-topo] [--dados DIR] [--versao cascata-v1]
[--registrar]. As notas são as do bakeoff_juiz.py (mesmo pool por fala); vários arquivos do professor se somam.
--julgar-topo completa, no último arquivo do professor, as notas que faltam dos 6 escolhidos pelo juiz de produção
(bakeoff_juiz.py --juizes producao), sem julgar o pool inteiro. O limiar é a menor margem com precisão >= 0,90 nas 10
sessões; a estimativa fixa o limiar numa metade das sessões e mede na outra. --registrar grava a versão no registro.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import date
from pathlib import Path

import bakeoff_juiz as bakeoff

sys.path.insert(0, str(bakeoff.ROOT / 'mvp-copiloto' / 'src'))
from copiloto import aluno, cascata  # noqa: E402

ALVO_PRECISAO = 0.90
REGISTRO = bakeoff.ROOT / 'mvp-copiloto' / 'data' / 'juiz-v2' / 'registro.jsonl'


def ler_notas(*caminhos: Path) -> dict[tuple[str, str], dict[str, float]]:
    notas: dict[tuple[str, str], dict[str, float]] = {}
    for caminho in caminhos:
        for r in bakeoff.ler(caminho):
            notas.setdefault((r['sessao'], r['id']), {}).update(zip(r['trechos'], r['notas'], strict=True))
    return notas


def julgar_topo(sessoes: list[bakeoff.SessaoPool], notas_aluno: dict, notas_professor: dict, destino: Path) -> None:
    juiz = None
    with destino.open('a', encoding='utf-8') as arquivo:
        for gold, pool in sessoes:
            ids, materiais = [t['trecho_id'] for t in pool], [t['pmcid'] for t in pool]
            for fala in gold:
                chave = (fala['sessao'], fala['id'])
                escolhidos = [ids[i] for i in cascata.escolher(materiais, [notas_aluno[chave][t] for t in ids])]
                faltam = [t for t in escolhidos if t not in notas_professor.get(chave, {})]
                if not faltam:
                    continue
                juiz = juiz or bakeoff._producao()[0]
                textos = {t['trecho_id']: t['texto'] for t in pool}
                notas = juiz(fala['frase'], [textos[t] for t in faltam])
                notas_professor.setdefault(chave, {}).update(zip(faltam, notas, strict=True))
                arquivo.write(json.dumps({'sessao': fala['sessao'], 'id': fala['id'], 'trechos': faltam, 'notas': notas})
                              + '\n')
                arquivo.flush()


def falas(sessoes: list[bakeoff.SessaoPool], notas_aluno: dict, notas_professor: dict) -> list[dict]:
    saida = []
    for gold, pool in sessoes:
        ids, materiais = [t['trecho_id'] for t in pool], [t['pmcid'] for t in pool]
        for fala in gold:
            aluno_, professor = notas_aluno[fala['sessao'], fala['id']], notas_professor[fala['sessao'], fala['id']]
            escolhidos = cascata.escolher(materiais, [aluno_[t] for t in ids])
            melhor, margem = cascata.margem([materiais[i] for i in escolhidos], [professor[ids[i]] for i in escolhidos])
            vencedor = escolhidos[melhor]
            ancora = fala['ancora'] if fala['tipo'] == 'positivo' else None
            saida.append({'sessao': fala['sessao'], 'id': fala['id'], 'tipo': fala['tipo'], 'subtipo': fala['subtipo'],
                          'nota': margem if professor[ids[vencedor]] >= cascata.P_MIN else -math.inf,
                          'acerto': ancora is not None and materiais[vencedor] == ancora['pmcid'],
                          'ancora_no_topo': ancora is not None and ancora['trecho_id'] in {ids[i] for i in escolhidos}})
    return saida


def medir(falas_: list[dict], limiar: float) -> dict:
    mostradas = [f for f in falas_ if f['nota'] >= limiar]
    positivos = [f for f in falas_ if f['tipo'] == 'positivo']
    negativos = [f for f in falas_ if f['tipo'] == 'negativo']
    certos = sum(f['acerto'] for f in mostradas)
    return {'precisao': bakeoff.wilson(certos, len(mostradas)), 'cobertura': bakeoff.wilson(certos, len(positivos)),
            'cartao_falso': bakeoff.wilson(sum(f['tipo'] == 'negativo' for f in mostradas), len(negativos)),
            'cartao_falso_por_subtipo': {s: f'{sum(f["nota"] >= limiar for f in g)}/{len(g)}' for s in bakeoff.NEGATIVOS
                                         if (g := [f for f in negativos if f['subtipo'] == s])}}


def estimar(falas_: list[dict], dobras: list[set[str]]) -> dict:
    """Each fold is measured at the threshold fixed on the other sessions, then the folds are pooled."""
    marcadas = []
    for dobra in dobras:
        limiar = bakeoff.limiar([f for f in falas_ if f['sessao'] not in dobra], ALVO_PRECISAO)
        marcadas += [f | {'nota': math.inf if f['nota'] >= limiar else -math.inf} for f in falas_ if f['sessao'] in dobra]
    return medir(marcadas, 0.0)


def sha256(caminho: Path) -> str:
    with caminho.open('rb') as arquivo:
        return hashlib.file_digest(arquivo, 'sha256').hexdigest()


def linha_registro(versao: str, limiar: float, falas_: list[dict], metades: list[set[str]]) -> dict:
    positivos = sum(f['tipo'] == 'positivo' for f in falas_)
    return {
        'versao': versao, 'data': date.today().isoformat(), 'promovida': False, 'estado': 'medida',
        'professor': {'modelo': 'gemma-4-E4B-it-Q4_K_M.gguf', 'lora': 'desligado (escala 0)',
                      'prompt': 'copiloto.juiz_llm.pedido_juiz'},
        'aluno': {'pasta': 'mvp-copiloto/modelos/juiz-local/aluno-gte-v1', 'base': f'{aluno.BASE}@{aluno.REVISAO_BASE}',
                  'adaptador_sha256': sha256(aluno.PASTA / 'adapter_model.safetensors')},
        'topo_aluno': cascata.TOPO_ALUNO, 'p_min': cascata.P_MIN,
        'limiares': {'margem': round(limiar, 6)},
        'regra': f'menor margem com precisão >= {ALVO_PRECISAO} nas {len({f["sessao"] for f in falas_})} sessões do gabarito',
        'gabarito': {'positivos': positivos, 'negativos': len(falas_) - positivos,
                     'ancora_no_topo_do_aluno': sum(f['ancora_no_topo'] for f in falas_)},
        'no_proprio_gabarito': medir(falas_, limiar),
        'estimativa_fora_da_dobra': {'dobras': [sorted(d) for d in metades], **estimar(falas_, metades)},
        'decisao': 'medida, não promovida: a promoção pelo ciclo.py decidir espera as notas do profissional',
    }


def registrar(linha: dict, arquivo: Path = REGISTRO) -> None:
    outras = [r for r in bakeoff.ler(arquivo) if r['versao'] != linha['versao']]
    arquivo.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in [*outras, linha]), encoding='utf-8')


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--aluno', type=Path, required=True)
    parser.add_argument('--professor', type=Path, nargs='+', required=True)
    parser.add_argument('--julgar-topo', action='store_true')
    parser.add_argument('--dados', type=Path, default=bakeoff.GOLD)
    parser.add_argument('--versao', default='cascata-v1')
    parser.add_argument('--registrar', action='store_true')
    args = parser.parse_args(argv)
    sessoes = bakeoff.carregar_sessoes(args.dados)
    notas_aluno, notas_professor = ler_notas(args.aluno), ler_notas(*args.professor)
    if args.julgar_topo:
        julgar_topo(sessoes, notas_aluno, notas_professor, args.professor[-1])
    falas_ = falas(sessoes, notas_aluno, notas_professor)
    nomes = sorted({f['sessao'] for f in falas_})
    metades = [set(nomes[:len(nomes) // 2]), set(nomes[len(nomes) // 2:])]
    linha = linha_registro(args.versao, bakeoff.limiar(falas_, ALVO_PRECISAO), falas_, metades)
    print(json.dumps(linha, ensure_ascii=False, indent=1))
    if args.registrar:
        registrar(linha)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
