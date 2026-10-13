"""Compara previsões com a nota do profissional nas avaliações reservadas para teste.
Uso: avaliar_5k.py NOME=PREVISOES.jsonl [NOME=PREVISOES.jsonl ...]

Cada linha traz `alvo_suave` (a nota do profissional) e `prob` (a previsão). Limiar de operação 0,9, o mesmo da nota "sim".
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

LIMIAR = 0.9


def postos(v: list[float]) -> list[float]:
    ordem = sorted(range(len(v)), key=lambda i: v[i])
    saida = [0.0] * len(v)
    i = 0
    while i < len(ordem):
        j = i
        while j + 1 < len(ordem) and v[ordem[j + 1]] == v[ordem[i]]:
            j += 1
        for k in range(i, j + 1):
            saida[ordem[k]] = (i + j) / 2
        i = j + 1
    return saida


def spearman(a: list[float], b: list[float]) -> float:
    ra, rb = postos(a), postos(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb, strict=True))
    den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5
    return num / den if den else float("nan")


def resumo(linhas: list[dict]) -> dict:
    notas, prev = [r["alvo_suave"] for r in linhas], [r["prob"] for r in linhas]
    sim = [n >= LIMIAR for n in notas]
    aprovados = [s for s, p in zip(sim, prev, strict=True) if p >= LIMIAR]
    return {"n": len(linhas), "spearman": round(spearman(notas, prev), 3), "aprovados": len(aprovados),
            "precisao_sim": round(sum(aprovados) / len(aprovados), 3) if aprovados else None,
            "cobertura_sim": round(sum(aprovados) / max(1, sum(sim)), 3),
            "nota_media_dos_aprovados": round(sum(n for n, p in zip(notas, prev, strict=True) if p >= LIMIAR) / len(aprovados), 3) if aprovados else None}


def main() -> None:
    for item in sys.argv[1:]:
        nome, caminho = item.split("=", 1)
        linhas = [json.loads(l) for l in Path(caminho).read_text(encoding="utf-8").splitlines() if l.strip()]
        print(nome, json.dumps(resumo(linhas), ensure_ascii=False))


if __name__ == "__main__":
    main()
