"""Corre o pipeline de ingestao sobre tudo o que esta no manifesto."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from copiloto import busca, embedder, ingestao  # noqa: E402
from copiloto.esquema import DIR_PDFS, conectar, criar_esquema  # noqa: E402

MANIFESTO = DIR_PDFS / "manifesto.json"


def main(modelo: str = embedder.PADRAO) -> None:
    if not MANIFESTO.exists():
        print("manifesto nao existe; corra scripts/baixar_pdfs.py primeiro")
        return
    itens = json.loads(MANIFESTO.read_text(encoding="utf-8"))
    con = conectar()
    criar_esquema(con)
    busca.INDICE.modelo = modelo

    print(f"modelo: {modelo}")
    print(f"obras no manifesto: {len(itens)}\n")

    for item in itens:
        caminho = DIR_PDFS / item["arquivo"]
        if not caminho.exists():
            print(f"  ! ficheiro ausente: {item['arquivo']}")
            continue
        obra_id, job_id = ingestao.registar_obra(
            con, caminho, item["titulo"], item["autor"], item["idioma"], item.get("ano")
        )
        if not job_id:
            print(f"  = ja no acervo: {item['arquivo']}")
            continue
        inicio = time.perf_counter()
        resultado = ingestao.processar(con, obra_id, modelo)
        duracao = time.perf_counter() - inicio
        if "erro" in resultado:
            print(f"  x {item['arquivo']}: {resultado['erro']}")
            continue
        print(
            f"  + {item['arquivo'][:52]:<52} "
            f"Recall@5 {resultado.get('recall_em_5', 0):.2f}  "
            f"MRR@10 {resultado.get('mrr_em_10', 0):.2f}  "
            f"{resultado.get('consultas', 0):>3} perguntas  {duracao:5.1f}s"
        )

    busca.INDICE.recarregar(con)
    total = con.execute("select count(*) as n from trecho").fetchone()["n"]
    obras = con.execute("select count(*) as n from obra where status='pronto'").fetchone()["n"]
    print(f"\nacervo pronto: {obras} obras, {total} trechos no indice")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else embedder.PADRAO)
