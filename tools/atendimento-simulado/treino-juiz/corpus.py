"""Passagens clínicas dos artigos de treino: os PDFs do manifesto fora das 100 sessões, cortados pelo chunker do copiloto.

Uso: corpus.py. Escreve <DADOS>/pmcids.txt, <DADOS>/passagens/<pmcid>.jsonl e <DADOS>/corpus.jsonl (trechos escolhidos pelo
mesmo filtro de candidatos.py, até 25 por artigo, com o tema do artigo).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'gold'))

import candidatos  # noqa: E402
import passagens  # noqa: E402

DADOS = passagens.ROOT / '.local' / 'claude-goal' / 'treino-juiz'


def pmcids_treino() -> list[str]:
    reservados = {fonte['pmcid'] for sessao in passagens.sessoes() for fonte in sessao['sources']}
    return sorted(set(passagens.artigos()) - reservados)


def main() -> None:
    DADOS.mkdir(parents=True, exist_ok=True)
    pmcids = pmcids_treino()
    (DADOS / 'pmcids.txt').write_text('\n'.join(pmcids) + '\n', encoding='utf-8')
    pasta = DADOS / 'passagens'
    passagens.main(['--pmcids', str(DADOS / 'pmcids.txt'), '--saida', str(pasta)])
    catalogo = passagens.artigos()
    total = elegiveis = 0
    with (DADOS / 'corpus.jsonl').open('w', encoding='utf-8') as saida:
        escolhidos = 0
        for pmcid in pmcids:
            trechos = list(passagens.carregar(pmcid, pasta).values())
            total += len(trechos)
            elegiveis += sum(candidatos.elegivel(t['texto']) for t in trechos)
            for trecho in candidatos.escolher(trechos):
                saida.write(json.dumps(trecho | {'tema': catalogo[pmcid]['theme']}, ensure_ascii=False) + '\n')
                escolhidos += 1
    print(f'{len(pmcids)} artigos de treino; {total} trechos, {elegiveis} elegíveis, {escolhidos} escolhidos')


if __name__ == '__main__':
    main()
