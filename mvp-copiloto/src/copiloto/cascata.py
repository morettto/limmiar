"""A regra da cascata, sem modelos: o aluno escolhe quem o professor julga e a margem entre materiais decide o cartão.

O gabarito (tools/atendimento-simulado/gold/cascata.py) fixa o limiar com estas mesmas funções.
"""
from __future__ import annotations

import math

TOPO_ALUNO = 6
P_MIN = 0.5


def escolher(materiais: list[str], notas_aluno: list[float], topo: int = TOPO_ALUNO) -> list[int]:
    """Os `topo` candidatos de maior nota do aluno. Se todos forem de um material, o último cede a vaga ao melhor
    candidato de outro material: a margem precisa de um segundo material para medir."""
    ordem = sorted(range(len(notas_aluno)), key=lambda i: -notas_aluno[i])
    escolhidos = ordem[:topo]
    if escolhidos and len({materiais[i] for i in escolhidos}) == 1:
        outro = next((i for i in ordem[topo:] if materiais[i] != materiais[escolhidos[0]]), None)
        if outro is not None:
            escolhidos[-1] = outro
    return escolhidos


def logit(p: float) -> float:
    return math.log(p) - math.log1p(-p)


def margem(materiais: list[str], notas: list[float]) -> tuple[int, float]:
    """(posição do trecho de maior nota, logit da nota do melhor material menos a do segundo); +inf sem segundo."""
    melhor = max(range(len(notas)), key=lambda i: notas[i])
    segundo = max((p for m, p in zip(materiais, notas, strict=True) if m != materiais[melhor]), default=None)
    return melhor, math.inf if segundo is None else logit(notas[melhor]) - logit(segundo)


def mostra(nota: float, margem_: float, limiar: float) -> bool:
    return nota >= P_MIN and margem_ >= limiar
