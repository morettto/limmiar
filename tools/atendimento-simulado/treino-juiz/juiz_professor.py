"""O professor como juiz no gabarito por construção: o teto do que um aluno destilado dele pode alcançar.

Uso: juiz_professor.py --nome NOME --saida DIR [--sessoes sessao-001 ...] [--paralelo P].
Pontua os pares em ordem de passagem (reuso de prefixo) e entrega as notas ao bakeoff_juiz.py, que mede como os demais juízes.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'gold'))

import bakeoff_juiz  # noqa: E402
from verificar import pontuar  # noqa: E402


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--nome', required=True)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--sessoes', nargs='*')
    parser.add_argument('--paralelo', type=int, default=2)
    args = parser.parse_args(argv)
    args.saida.mkdir(parents=True, exist_ok=True)
    sessoes = bakeoff_juiz.carregar_sessoes(bakeoff_juiz.GOLD, args.sessoes)
    pares = [{'frase': fala['frase'], 'trecho_id': t['trecho_id'], 'trecho': t['texto']}
             for gold, pool in sessoes for fala in gold for t in pool]
    notas = {(r['frase'], r['trecho_id']): r['nota_professor']
             for r in pontuar(pares, args.saida / 'brutos-gold.jsonl', args.paralelo)}
    por_texto = {t['texto']: t['trecho_id'] for _, pool in sessoes for t in pool}
    # A missing yes/no (neither token in the top 20) scores 0.5, so it neither shows a card nor wins the ranking.
    juiz = lambda frase, textos: [n if (n := notas[frase, por_texto[t]]) is not None else 0.5 for t in textos]  # noqa: E731
    bakeoff_juiz.pontuar(args.nome, lambda: (juiz, None), sessoes, args.saida)
    resumo = {args.nome: {'metricas': bakeoff_juiz.metricas(bakeoff_juiz._com_notas(
        bakeoff_juiz._em_cache(args.saida / f'{args.nome}.jsonl', sessoes)[0], sessoes))}}
    (args.saida / 'resumo.json').write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding='utf-8')
    print(bakeoff_juiz.tabela(resumo))


if __name__ == '__main__':
    main(sys.argv[1:])
