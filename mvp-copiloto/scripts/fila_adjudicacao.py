"""Junta, para adjudicação, o trecho que o juiz mais aprovou em cada positivo, quando não está no rótulo.

É o único trecho que pode virar cartão, seja qual for o limiar.

  COPILOTO_CORPUS=teste python scripts/fila_adjudicacao.py

Grava resultados/adjudicar-<corpus>.jsonl. Cada linha é um par (caso, trecho) ainda sem veredito em
data/avaliacao/<corpus>_adjudicacoes.jsonl. O veredito é escrito nesse ficheiro com
{"id", "arquivo", "pagina", "valido", "motivo"}.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from copiloto import decisao  # noqa: E402
from copiloto.esquema import CORPUS, RAIZ, conectar  # noqa: E402

PREFIXO = "teste" if CORPUS == "teste" else "dev"
DADOS = RAIZ / "data" / "avaliacao"


def main() -> None:
    casos = {json.loads(l)["id"]: json.loads(l) for l in (DADOS / f"{PREFIXO}_positivos.jsonl").open(encoding="utf-8") if l.strip()}
    feitos = set()
    arquivo_adj = DADOS / f"{PREFIXO}_adjudicacoes.jsonl"
    if arquivo_adj.exists():
        feitos = {(a["id"], a["arquivo"], int(a["pagina"])) for a in map(json.loads, arquivo_adj.open(encoding="utf-8")) if a}
    fonte = {}
    for linha in (RAIZ / "data" / (CORPUS or "") / "trechos_fonte.jsonl").open(encoding="utf-8"):
        t = json.loads(linha)
        fonte[(t["arquivo"], t["pagina"], t["paragrafo"])] = t["texto"]
    con = conectar()
    fila = []
    for linha in (RAIZ / "resultados" / f"registos-{PREFIXO}-pipeline-{decisao.decisor()}.jsonl").open(encoding="utf-8"):
        r = json.loads(linha)
        caso = casos.get(r["id"])
        if not caso:
            continue
        alvos = {(a["arquivo"], int(a["pagina"])) for a in caso["alvos"]}
        aprovados = [c for c in r["decisao"].get("candidatos", []) if c.get("juiz") and c["juiz"]["corresponde"] and c["juiz"]["citacao_confere"]]
        for c in sorted(aprovados, key=lambda c: -c["juiz"]["probabilidade"])[:1]:
            j = c["juiz"]
            chave = (c["arquivo"], int(c["pagina"]))
            if chave in alvos or (caso["id"], *chave) in feitos:
                continue
            texto = con.execute("select texto from trecho where id = ?", (c["trecho_id"],)).fetchone()
            f = caso.get("fonte", {})
            fila.append({
                "id": caso["id"], "fala": caso["fala"], "contexto": caso["contexto"], "fenomeno_rotulado": caso["fenomeno"],
                "trecho_do_rotulo": fonte.get((f.get("arquivo"), f.get("pagina"), f.get("paragrafo")), ""),
                "arquivo": chave[0], "pagina": chave[1], "trecho_aprovado": texto["texto"] if texto else "",
                "probabilidade_juiz": j["probabilidade"],
            })
    destino = RAIZ / "resultados" / f"adjudicar-{PREFIXO}.jsonl"
    destino.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in fila), encoding="utf-8")
    print(f"{destino}: {len(fila)} pares por adjudicar")


if __name__ == "__main__":
    main()
