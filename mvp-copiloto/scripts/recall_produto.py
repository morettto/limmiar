import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import busca
from copiloto.esquema import conectar

con = conectar()
busca.INDICE.recarregar(con)
for parte in sys.argv[1].split(","):
    itens = [json.loads(l) for l in open(RAIZ / "data" / "avaliacao" / f"produto_{parte}.jsonl", encoding="utf-8")]
    pos = [x for x in itens if x["tipo"] == "positivo"]
    r10 = r20 = 0
    for x in pos:
        ids = [c.trecho_id for c in busca.candidatos_amplos(con, x["fala"], x["idioma"], 20)]
        r10 += any(t in x["esperados"] for t in ids[:10])
        r20 += any(t in x["esperados"] for t in ids)
    print(f"{parte} adaptador={busca._adaptador() is not None} lexica={busca.FONTES_LEXICAS}: recall@10 {r10/len(pos):.0%} recall@20 {r20/len(pos):.0%}")
