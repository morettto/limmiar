"""Compara probabilidades de um juiz com os rótulos. Uso: medir.py SAIDA.jsonl [...]."""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict


def wilson(acertos: int, total: int) -> float:
    if not total:
        return 0.0
    p, z = acertos / total, 1.96
    return (p + z * z / (2 * total) - z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / (1 + z * z / total)


def auroc(linhas: list[dict]) -> float:
    pos = [l["prob"] for l in linhas if l["alvo"] == 1]
    neg = [l["prob"] for l in linhas if l["alvo"] == 0]
    if not pos or not neg:
        return float("nan")
    ganhos = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return ganhos / (len(pos) * len(neg))


def no_limiar(linhas: list[dict], t: float) -> dict:
    mostrados = [l for l in linhas if l["prob"] >= t]
    certos = sum(l["alvo"] == 1 for l in mostrados)
    positivos = sum(l["alvo"] == 1 for l in linhas)
    return {"limiar": t, "precisao": round(certos / len(mostrados), 3) if mostrados else None,
            "wilson": round(wilson(certos, len(mostrados)), 3), "recall": round(certos / positivos, 3) if positivos else None,
            "acuracia": round(sum((l["prob"] >= t) == (l["alvo"] == 1) for l in linhas) / len(linhas), 3)}


def resumo(linhas: list[dict]) -> dict:
    linhas = [l for l in linhas if not math.isnan(l["prob"])]
    curva = [no_limiar(linhas, t / 100) for t in range(5, 100, 5)]
    melhor = max(curva, key=lambda r: r["acuracia"])
    por_origem = defaultdict(list)
    for l in linhas:
        por_origem[l["origem"]].append(l)
    return {"n": len(linhas), "auroc": round(auroc(linhas), 3), "melhor_acuracia": melhor,
            "wilson_088": next((r for r in sorted(curva, key=lambda r: -(r["recall"] or 0)) if r["wilson"] >= .88), None),
            "por_origem": {o: {"n": len(v), "acuracia@melhor": round(sum((l["prob"] >= melhor["limiar"]) == (l["alvo"] == 1) for l in v) / len(v), 3)}
                           for o, v in sorted(por_origem.items())}}


if __name__ == "__main__":
    for arquivo in sys.argv[1:]:
        linhas = [json.loads(l) for l in open(arquivo, encoding="utf-8") if l.strip()]
        print(arquivo, json.dumps(resumo(linhas), ensure_ascii=False, indent=1))
