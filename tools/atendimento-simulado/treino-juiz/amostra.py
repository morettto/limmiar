"""Amostra para auditar o professor: N positivos e N negativos sorteados dos pares verificados.

Uso: amostra.py --pares ARQ --saida ARQ [--n 20]. Negativos sorteados por tipo em rodízio, para cobrir todo tipo.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--pares', type=Path, required=True)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--n', type=int, default=20)
    args = parser.parse_args(argv)
    sorteio = random.Random(20261020)
    pares = [json.loads(l) for l in args.pares.read_text(encoding='utf-8').splitlines() if l.strip()]
    positivos = sorteio.sample([p for p in pares if p['rotulo'] == 1], args.n)
    por_tipo = defaultdict(list)
    for par in pares:
        if par['rotulo'] == 0:
            por_tipo[par['tipo']].append(par)
    filas = [sorteio.sample(itens, len(itens)) for _, itens in sorted(por_tipo.items())]
    negativos = []
    while len(negativos) < args.n and any(filas):
        negativos += [fila.pop() for fila in filas if fila][:args.n - len(negativos)]
    campos = ('frase', 'trecho', 'rotulo', 'tipo', 'nota_professor')
    args.saida.write_text(''.join(json.dumps({k: p[k] for k in campos}, ensure_ascii=False) + '\n'
                                  for p in positivos + negativos), encoding='utf-8')
    print(f'{len(positivos)} positivos e {len(negativos)} negativos em {args.saida}')


if __name__ == '__main__':
    main(sys.argv[1:])
