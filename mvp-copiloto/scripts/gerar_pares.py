"""Gera pares (fala, trecho) para treinar e testar o juiz: os 4 trechos que a busca traria, mais o trecho de origem.

  COPILOTO_CORPUS=teste python scripts/gerar_pares.py

Grava data/avaliacao/<corpus>_pares.jsonl, ainda sem rótulo.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import busca, embedder, traducao  # noqa: E402
from copiloto.esquema import CORPUS, DIR_DADOS, RAIZ, conectar  # noqa: E402

PREFIXO = "teste" if CORPUS == "teste" else "dev"
DADOS = RAIZ / "data" / "avaliacao"
POR_FALA = 4


def main() -> None:
    casos = []
    for nome in (f"{PREFIXO}_positivos.jsonl", f"{PREFIXO}_negativos.jsonl"):
        casos += [json.loads(l) for l in (DADOS / nome).open(encoding="utf-8") if l.strip()]
    casos = [c for c in casos if c["tipo"] in ("positivo", "quase")]
    fonte = {}
    for linha in (DIR_DADOS / "trechos_fonte.jsonl").open(encoding="utf-8"):
        t = json.loads(linha)
        fonte[(t["arquivo"], t["pagina"], t["paragrafo"])] = t
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    pares = []
    for n, caso in enumerate(casos, 1):
        vistos = set()
        base = {k: caso[k] for k in ("id", "fala", "contexto", "idioma", "tipo")}
        for c in busca.candidatos_amplos(con, caso["fala"], caso["idioma"], POR_FALA):
            vistos.add((c.arquivo, c.pagina, c.paragrafo))
            pares.append({**base, "arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo,
                          "trecho": c.texto, "origem": "busca"})
        f = caso.get("fonte")
        if caso["tipo"] == "positivo" and f and (f["arquivo"], f["pagina"], f["paragrafo"]) not in vistos:
            t = fonte.get((f["arquivo"], f["pagina"], f["paragrafo"]))
            if t:
                pares.append({**base, "arquivo": t["arquivo"], "pagina": t["pagina"], "paragrafo": t["paragrafo"],
                              "trecho": t["texto"], "origem": "rotulo"})
        if n % 100 == 0:
            print(f"  {n}/{len(casos)}", flush=True)
    for i, p in enumerate(pares, 1):
        p["par_id"] = f"{PREFIXO}-par-{i:05d}"
    destino = DADOS / f"{PREFIXO}_pares.jsonl"
    destino.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in pares), encoding="utf-8")
    print(f"{destino}: {len(pares)} pares de {len(casos)} falas")


if __name__ == "__main__":
    main()
