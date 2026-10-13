"""Mede recall@k da geracao de candidatos nos positivos de um corpus (sem LLM)."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import busca, embedder, portao, traducao  # noqa: E402
from copiloto.esquema import CORPUS, RAIZ, conectar  # noqa: E402


def main() -> None:
    prefixo = "teste" if CORPUS == "teste" else "dev"
    casos = [json.loads(l) for l in (RAIZ / "data" / "avaliacao" / f"{prefixo}_positivos.jsonl").open(encoding="utf-8")]
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    termos = {c["id"]: portao.triar(c["fala"], c["contexto"]).termos for c in casos}
    print("exemplos de termos:", [termos[c["id"]] for c in casos[:3]], flush=True)
    modos = {
        "amplo top20": lambda c: busca.candidatos_amplos(con, c["fala"], c["idioma"], 20),
        "amplo top20 + termos": lambda c: busca.candidatos_amplos(con, c["fala"], c["idioma"], 20, extras=[termos[c["id"]]]),
        "amplo top30 + termos": lambda c: busca.candidatos_amplos(con, c["fala"], c["idioma"], 30, extras=[termos[c["id"]]]),
    }
    for nome, funcao in modos.items():
        acertos = 0
        for caso in casos:
            achados = {(c.arquivo, c.pagina) for c in funcao(caso)}
            acertos += any((a["arquivo"], a["pagina"]) in achados for a in caso["alvos"])
        print(f"{nome:24} recall {acertos}/{len(casos)} = {acertos / len(casos):.3f}", flush=True)


if __name__ == "__main__":
    main()
