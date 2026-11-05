"""Roda o copiloto em processo sobre o gabarito: cada fala desenhada entra na sessão e passa pela mesma decisão da API.

Uso: avaliar_copiloto.py RUN [--sessoes sessao-006 ...] [--limite N]. Saída em .local/claude-goal/gold/resultados/RUN.jsonl
(retomável) e RUN.resumo.json (pontuar.py). O juiz é o juiz pequeno, no processo (COPILOTO_JUIZ_DIR, COPILOTO_JUIZ_ONNX).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch

import numpy as np

from candidatos import arquivo as arquivo_candidatos
from passagens import GOLD, acervo_profissional, artigos
from pontuar import relatorio
from validar_gold import validar_sessao

CACHE = GOLD / f'cache-{acervo_profissional.embedder.PADRAO}'
RESULTADOS = GOLD / 'resultados'
CONTEXTO_MAX = 5
CHAMADAS_JUIZ: list[None] = []

Decidir = Callable[[str, list[str]], object]
AbrirSessao = Callable[[str, list[str]], AbstractContextManager[Decidir]]


def ler(caminho: Path) -> list[dict]:
    if not caminho.exists():
        return []
    return [json.loads(linha) for linha in caminho.read_text(encoding='utf-8').splitlines() if linha.strip()]


def consultas(turnos: list[dict], gold: list[dict]) -> list[tuple[dict, list[str]]]:
    """Each gold row with the patient statements before it, its own earlier insertions included, like the app's last 5."""
    por_turno = defaultdict(list)
    for row in gold:
        por_turno[row['inserir_apos_turno']].append(row)
    falas, saida = [], []
    for turno in turnos:
        if turno['role'] == 'Paciente':
            falas.append(turno['text'])
        for row in por_turno[turno['index']]:
            saida.append((row, falas[-CONTEXTO_MAX:]))
            falas.append(row['frase'])
    return saida


def rodar_fala(decidir: Decidir, gold: dict, contexto: list[str]) -> dict:
    inicio, antes = time.perf_counter(), len(CHAMADAS_JUIZ)
    decisao = decidir(gold['frase'], contexto)
    return {
        'sessao': gold['sessao'], 'id': gold['id'],
        'cartoes': [{'trecho_id': c.trecho_id, 'pmcid': c.arquivo, 'pagina': c.pagina, 'probabilidade': c.probabilidade,
                     'nivel': c.nivel, 'citacao_literal': c.citacao_literal} for c in decisao.cartoes],
        'alerta_risco': decisao.alerta_risco, 'clarificar': decisao.clarificar, 'motivo_silencio': decisao.motivo_silencio,
        'ms': round((time.perf_counter() - inicio) * 1000, 1), 'chamadas_juiz': len(CHAMADAS_JUIZ) - antes,
        'tempos_ms': decisao.tempos_ms, 'contexto': contexto,
        'candidatos': [r['trecho_id'] for r in decisao.candidatos],
        'julgados': [r['trecho_id'] for r in decisao.candidatos if 'juiz' in r],
    }


def avaliar(sessoes: list[str], saida: Path, abrir_sessao: AbrirSessao, limite: int | None = None) -> int:
    feitos = {(row['sessao'], row['id']) for row in ler(saida)}
    saida.parent.mkdir(parents=True, exist_ok=True)
    novos = 0
    for sessao_id in sessoes:
        if limite is not None and novos >= limite:
            break
        contexto = json.loads(arquivo_candidatos(sessao_id).read_text(encoding='utf-8'))
        gold = ler(GOLD / 'sessoes' / f'{sessao_id}.jsonl')
        pendentes = [par for par in consultas(contexto['turnos'], gold) if (sessao_id, par[0]['id']) not in feitos]
        pendentes = pendentes if limite is None else pendentes[:limite - novos]
        if not pendentes:
            continue
        with abrir_sessao(sessao_id, [m['pmcid'] for m in contexto['materiais']]) as decidir, \
                saida.open('a', encoding='utf-8') as arquivo:
            for row, anteriores in pendentes:
                arquivo.write(json.dumps(rodar_fala(decidir, row, anteriores), ensure_ascii=False) + '\n')
                arquivo.flush()
                novos += 1
                print(f'{sessao_id} {row["id"]}', flush=True)
    return novos


def resumo(saida: Path) -> tuple[dict, list[str]]:
    dados, erros = relatorio(saida)
    final = dados or {'erros': erros}
    saida.with_suffix('.resumo.json').write_text(json.dumps(final, ensure_ascii=False, indent=1), encoding='utf-8')
    return final, erros


def preparar(owner: str, pmcid: str, artigo: dict):
    from copiloto import embedder, juiz_pequeno
    data = Path(artigo['path']).read_bytes()
    campos = {'titulo': artigo['title'], 'autores': ', '.join(artigo['authors']) or '-', 'tipo': 'pdf',
              'sha256': artigo['sha256']}
    cache = CACHE / f'{pmcid}-{artigo["sha256"]}.npz'
    salvo = {}
    if cache.exists():
        with np.load(cache) as arquivo:
            salvo = dict(arquivo)
    # The real preparar still parses the PDF; bge-m3 and the generico question are each swapped for what they
    # produced before, when the cache holds it for the current model or judge version.
    trocas = []
    if str(salvo.get('modelo')) == embedder.PADRAO:
        vetores = dict(zip(salvo['textos'].tolist(), salvo['vetores']))
        trocas.append(patch.object(acervo_profissional.embedder, 'codificar_documentos',
                                   side_effect=lambda textos, *_, **__: np.stack([vetores[t] for t in textos])))
    if str(salvo.get('juiz')) == juiz_pequeno.VERSAO:
        genericos = dict(zip(salvo['textos'].tolist(), salvo['generico'].tolist()))
        trocas.append(patch.object(acervo_profissional.juiz_pequeno, 'generico',
                                   side_effect=lambda textos: [genericos[t] for t in textos]))
    with ExitStack() as pilha:
        for troca in trocas:
            pilha.enter_context(troca)
        material = acervo_profissional.ACERVO.preparar(owner, pmcid, data, campos)
    if len(trocas) < 2:
        CACHE.mkdir(parents=True, exist_ok=True)
        temporario = cache.with_suffix('.tmp.npz')
        np.savez(temporario, textos=np.array([bloco.texto for bloco in material.blocks]), vetores=material.embeddings,
                 modelo=np.array(material.model), generico=material.generico, juiz=np.array(juiz_pequeno.VERSAO))
        temporario.replace(cache)
    return material


@contextmanager
def sessao_real(sessao_id: str, pmcids: list[str]) -> Iterator[Decidir]:
    from copiloto import decisao
    owner, catalogo = f'eval-{sessao_id}', artigos()
    for pmcid in pmcids:
        preparar(owner, pmcid, catalogo[pmcid])
    snapshot = acervo_profissional.ACERVO.snapshot(owner, pmcids)
    limites = decisao.limiares()
    try:
        yield lambda frase, contexto: decisao.decidir(
            snapshot.connection, frase, contexto, 'paciente', pmcids, limites, indice=snapshot.index,
            verificar_proveniencia=snapshot.proveniencia)
    finally:
        snapshot.connection.close()
        for pmcid in pmcids:
            acervo_profissional.ACERVO.remover(owner, pmcid)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('run')
    parser.add_argument('--sessoes', nargs='*')
    parser.add_argument('--limite', type=int)
    args = parser.parse_args(argv)
    from copiloto import juiz_pequeno, qualificacao
    if not qualificacao.qualificado(juiz_pequeno.VERSAO):
        raise SystemExit(f'versão {juiz_pequeno.VERSAO!r} do juiz sem cortes no registro')
    if faltam := [str(arquivo) for arquivo in juiz_pequeno.arquivos() if not arquivo.is_file()]:
        raise SystemExit(f'juiz pequeno ausente: {", ".join(faltam)}')
    original = juiz_pequeno._notas

    def contar(*args, **kwargs):
        CHAMADAS_JUIZ.append(None)
        return original(*args, **kwargs)

    juiz_pequeno._notas = contar
    sessoes = []
    for caminho in sorted((GOLD / 'sessoes').glob('sessao-*.jsonl')):
        if args.sessoes is None or caminho.stem in args.sessoes:
            if erros := validar_sessao(caminho.stem):
                print(f'{caminho.stem}: ignorada, gabarito inválido ({len(erros)} erros)', file=sys.stderr)
            else:
                sessoes.append(caminho.stem)
    saida = RESULTADOS / f'{args.run}.jsonl'
    print(f'{avaliar(sessoes, saida, sessao_real, args.limite)} falas novas em {saida}', flush=True)
    final, erros = resumo(saida)
    for erro in erros:
        print(erro, file=sys.stderr)
    print(json.dumps(final.get('custo', final), ensure_ascii=False))
    return 1 if erros else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
