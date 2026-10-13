"""AUROC por origem. Uso: avaliar_cv.py PREVISOES.jsonl [...]"""
import json
import sys


def auroc(l):
    p = [x["prob"] for x in l if x["alvo"] == 1]; n = [x["prob"] for x in l if x["alvo"] == 0]
    return sum((a > b) + .5 * (a == b) for a in p for b in n) / (len(p) * len(n)) if p and n else float("nan")


def melhor(l, alvo_prec=0.8):
    ts = sorted({x["prob"] for x in l}, reverse=True)
    best = (0, None)
    for t in ts:
        m = [x for x in l if x["prob"] >= t]
        if not m: continue
        prec = sum(x["alvo"] for x in m) / len(m)
        rec = sum(x["alvo"] for x in m) / max(1, sum(x["alvo"] for x in l))
        if prec >= alvo_prec and rec > best[0]: best = (rec, t)
    return best


for arq in sys.argv[1:]:
    L = [json.loads(l) for l in open(arq, encoding="utf-8") if l.strip()]
    d = [x for x in L if x["origem"] == "dificil"]; f = [x for x in L if x["origem"] == "fonte-dev"]
    r80, t80 = melhor(d, .8)
    print(f"{arq.split('/')[-1]:34} n={len(L)} AUROC geral {auroc(L):.3f} | difíceis(n={len(d)}) {auroc(d):.3f} | fonte-dev(n={len(f)}) {auroc(f):.3f} | difíceis: recall {r80:.2f} com precisão>=0,80")
