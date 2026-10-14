"""Fluxo completo no desenvolvimento. Uso: analisar_fluxo.py PORTAO.jsonl JUIZ.jsonl."""
from __future__ import annotations

import json
import sys
from collections import defaultdict

portao = {(r := json.loads(l))["id"]: r for l in open(sys.argv[1], encoding="utf-8") if l.strip()}
juiz = [json.loads(l) for l in open(sys.argv[2], encoding="utf-8") if l.strip()]
por_caso = defaultdict(list)
for j in juiz:
    por_caso[j["id"]].append(j)
tipos = defaultdict(list)
for i, p in portao.items():
    tipos[p["tipo"] if p["tipo"] != "positivo" else "positivo/" + str(p["canal"])].append(i)
print("tipos:", {k: len(v) for k, v in tipos.items()})
print(f"{'portão':>6}{'juiz':>6} | " + " ".join(f"{k[:14]:>14}" for k in sorted(tipos)) + " | cartões/pos  página-alvo  ouro-pos")
for g in (0.3, 0.5, 0.7):
    for t in (0.35, 0.5, 0.7, 0.85):
        linha, cartoes, achou, ouro, npos = [], 0, 0, 0, 0
        for k in sorted(tipos):
            ids = tipos[k]; com = 0
            for i in ids:
                cs = [j for j in por_caso[i] if portao[i]["prob"] >= g and j["prob"] >= t] if i in por_caso else []
                com += bool(cs)
                if k.startswith("positivo"):
                    npos += 1; cartoes += len(cs); achou += any(j["pagina_alvo"] for j in cs); ouro += any(j["ouro"] for j in cs)
            linha.append(com / len(ids))
        print(f"{g:6}{t:6} | " + " ".join(f"{x:14.2f}" for x in linha) + f" | {cartoes / npos:11.1f} {achou / npos:12.2f} {ouro / npos:9.2f}")
