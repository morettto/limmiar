import json
import sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import busca, embedder, hibrido, traducao
from copiloto.esquema import conectar

regs = [json.loads(l) for a in sys.argv[1].split(",") for l in open(RAIZ / "resultados" / a, encoding="utf-8")]
con = conectar()
busca.INDICE.recarregar(con)
ids, obras = busca.INDICE.ids, busca.INDICE.obras
PROF = 50


def cortar(ordem, limite, por_obra=4):
    saida, contagem = [], {}
    for i in ordem:
        if contagem.get(obras[i], 0) >= por_obra:
            continue
        contagem[obras[i]] = contagem.get(obras[i], 0) + 1
        saida.append(i)
        if len(saida) >= limite:
            break
    return saida


estrategias = {}
for r in regs:
    if r["tipo"] != "positivo":
        continue
    alvos = set(r["esperados"])
    variantes = list(dict.fromkeys(traducao.variantes(r["fala"], r["idioma"]).values()))
    densas = []
    for vetor in embedder.codificar_consultas(variantes, busca.INDICE.modelo):
        s = busca.INDICE.matriz @ vetor
        densas.append([int(i) for i in np.argsort(-s)[:PROF]])
    lexicas = [[i for i in busca.INDICE.lexical.ordenar(v, PROF)] for v in variantes]
    candidatos = {
        "atual": hibrido.fundir_rrf(*densas, *lexicas, k=PROF * 6),
        "so_densa": hibrido.fundir_rrf(*densas, k=PROF * 3),
        "densa+bm25_orig": hibrido.fundir_rrf(*densas, lexicas[0], k=PROF * 4),
        "densa_x2+bm25": hibrido.fundir_rrf(*densas, *densas, *lexicas, k=PROF * 6),
    }
    for nome, ordem in candidatos.items():
        for limite in (10, 15, 20):
            for po in (3, 4, 6):
                chave = f"{nome} k={limite} por_obra={po}"
                achou = any(ids[i] in alvos for i in cortar(ordem, limite, po))
                estrategias[chave] = estrategias.get(chave, 0) + achou
n = sum(r["tipo"] == "positivo" for r in regs)
for chave, v in estrategias.items():
    print(f"{chave}: {v}/{n} ({v/n:.0%})")
