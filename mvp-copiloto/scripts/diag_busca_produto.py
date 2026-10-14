import json
import sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import busca, embedder, traducao, treinado
from copiloto.esquema import conectar

regs = [json.loads(l) for l in open(RAIZ / "resultados" / sys.argv[1], encoding="utf-8")]
con = conectar()
busca.INDICE.recarregar(con)
ids = busca.INDICE.ids
pos_de = {t: i for i, t in enumerate(ids)}
textos = dict(con.execute("select id, texto from trecho"))


def rank(ordem, alvos):
    rs = [n for n, i in enumerate(ordem) if ids[i] in alvos]
    return rs[0] if rs else None


linhas = []
for r in regs:
    if r["tipo"] != "positivo":
        continue
    alvos = set(r["esperados"])
    variantes = list(dict.fromkeys(traducao.variantes(r["fala"], r["idioma"]).values()))
    densas, lexicas = [], []
    for v, vetor in zip(variantes, embedder.codificar_consultas(variantes, busca.INDICE.modelo)):
        densas.append(rank(list(np.argsort(-(busca.INDICE.matriz @ vetor))), alvos))
        lexicas.append(rank(busca.INDICE.lexical.ordenar(v, len(ids)), alvos))
    amplos = busca.candidatos_amplos(con, r["fala"], r["idioma"], 60, por_obra=60, profundidade=200)
    fundido = rank([pos_de[c.trecho_id] for c in amplos], alvos)
    nota = max(treinado.julgar(r["fala"], [], [textos[t] for t in alvos]))
    linhas.append((r["id"], fundido, densas, lexicas, round(nota, 3), r["fala"][:60]))
    print(*linhas[-1], flush=True)
