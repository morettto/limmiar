"""O professor dá P(yes) a cada par e só ficam os pares em que ele confirma o rótulo de construção com folga.

Uso: verificar.py --geracao ARQ [--conversa ARQ] --saida DIR [--paralelo P].
Pares: cada positivo e negativo difícil com a sua passagem; cada positivo contra outra passagem do mesmo artigo; dois
positivos contra passagens de outro artigo do mesmo tema; cada fala de conversa contra duas passagens ao acaso.
Grava <saida>/brutos.jsonl (toda nota, retomável) e <saida>/pares.jsonl (p_yes >= 0.8 nos positivos, <= 0.2 nos negativos).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

import professor
from corpus import DADOS
from gerar import ler

LIMIAR_POSITIVO, LIMIAR_NEGATIVO = 0.8, 0.2
CRUZADOS_TEMA = 2
CONVERSA_POR_FALA = 2


def montar(geracao: list[dict], conversa: list[dict], corpus: list[dict]) -> list[dict]:
    indice = {t['trecho_id']: t for t in corpus}
    # Cross pairs land on passages that already have their own pairs, so they share that passage's cached prefix.
    gerados = [indice[r['trecho_id']] for r in geracao if 'erro' not in r]
    por_artigo, por_tema = defaultdict(list), defaultdict(list)
    for trecho in gerados:
        por_artigo[trecho['pmcid']].append(trecho)
        por_tema[trecho['tema']].append(trecho)
    pares = []

    def par(frase: str, tipo: str, rotulo: int, pmcid_frase: str | None, trecho: dict) -> None:
        pares.append({'frase': frase, 'tipo': tipo, 'rotulo_construcao': rotulo, 'pmcid_frase': pmcid_frase,
                      'trecho_id': trecho['trecho_id'], 'pmcid_trecho': trecho['pmcid'], 'trecho': trecho['texto']})

    for row in geracao:
        if 'erro' in row:
            continue
        proprio, sorteio = indice[row['trecho_id']], random.Random(row['trecho_id'])
        for frase in row['positivos']:
            par(frase, 'positivo', 1, row['pmcid'], proprio)
        for tipo, frase in row['negativos'].items():
            par(frase, tipo, 0, row['pmcid'], proprio)
        vizinhos = [t for t in por_artigo[row['pmcid']] if t['trecho_id'] != row['trecho_id']]
        for frase in row['positivos'] if vizinhos else []:
            par(frase, 'mesmo_artigo', 0, row['pmcid'], sorteio.choice(vizinhos))
        tema = [t for t in por_tema[row['tema']] if t['pmcid'] != row['pmcid']]
        for frase in row['positivos'][:CRUZADOS_TEMA] if tema else []:
            par(frase, 'mesmo_tema', 0, row['pmcid'], sorteio.choice(tema))
    for row in conversa:
        sorteio = random.Random(f'conversa:{row["indice"]}')
        for frase in row.get('falas', []):
            for trecho in sorteio.sample(gerados, CONVERSA_POR_FALA):
                par(frase, row['subtipo'], 0, None, trecho)
    return pares


def _chave(par: dict) -> tuple[str, str]:
    return par['frase'], par['trecho_id']


def pontuar(pares: list[dict], caminho: Path, paralelo: int) -> list[dict]:
    feitos = {_chave(r): r for r in ler(caminho)}
    grupos = defaultdict(list)
    for par in pares:
        if _chave(par) not in feitos:
            grupos[par['trecho_id']].append(par)
    total, inicio, trava = sum(map(len, grupos.values())), time.perf_counter(), Lock()
    print(f'{len(pares)} pares, {total} pendentes em {len(grupos)} passagens', flush=True)
    contagem = [0]

    def grupo(itens: list[dict]) -> None:
        # One passage at a time per worker, so every pair after the first reuses the passage prefix in its slot.
        for par in itens:
            nota = professor.p_sim(par['trecho'], par['frase'])
            with trava:
                arquivo.write(json.dumps(par | {'nota_professor': nota}, ensure_ascii=False) + '\n')
                arquivo.flush()
                feitos[_chave(par)] = par | {'nota_professor': nota}
                contagem[0] += 1
                if contagem[0] % 200 == 0 or contagem[0] == total:
                    gasto = time.perf_counter() - inicio
                    print(f'{contagem[0]}/{total} em {gasto:.0f}s; {3600 * contagem[0] / gasto:.0f} pares/h', flush=True)

    with caminho.open('a', encoding='utf-8') as arquivo, ThreadPoolExecutor(paralelo) as pool:
        list(pool.map(grupo, grupos.values()))
    return [feitos[_chave(p)] for p in pares]


def filtrar(notas: list[dict]) -> list[dict]:
    mantidos = []
    for r in notas:
        nota = r['nota_professor']
        if nota is None or not (nota >= LIMIAR_POSITIVO if r['rotulo_construcao'] else nota <= LIMIAR_NEGATIVO):
            continue
        mantidos.append({'frase': r['frase'], 'trecho': r['trecho'], 'rotulo': r['rotulo_construcao'],
                         'nota_professor': round(nota, 6), 'tipo': r['tipo'], 'pmcid_frase': r['pmcid_frase'],
                         'pmcid_trecho': r['pmcid_trecho']})
    return mantidos


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--geracao', type=Path, required=True)
    parser.add_argument('--conversa', type=Path)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--paralelo', type=int, default=2)
    args = parser.parse_args(argv)
    args.saida.mkdir(parents=True, exist_ok=True)
    pares = montar(ler(args.geracao), ler(args.conversa) if args.conversa else [], ler(DADOS / 'corpus.jsonl'))
    notas = pontuar(pares, args.saida / 'brutos.jsonl', args.paralelo)
    mantidos = filtrar(notas)
    (args.saida / 'pares.jsonl').write_text(''.join(json.dumps(m, ensure_ascii=False) + '\n' for m in mantidos),
                                            encoding='utf-8')
    total, ficou = Counter(r['tipo'] for r in notas), Counter(m['tipo'] for m in mantidos)
    for tipo in total:
        print(f'{tipo}: {ficou[tipo]}/{total[tipo]} mantidos')
    print(f'{len(mantidos)}/{len(notas)} pares mantidos em {args.saida / "pares.jsonl"}')


if __name__ == '__main__':
    main(sys.argv[1:])
