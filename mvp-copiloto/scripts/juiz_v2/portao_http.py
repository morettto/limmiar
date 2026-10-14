"""Portão pelo servidor (caminho de produção). Uso: COPILOTO_JUIZ_URL=... portao_http.py SAIDA.jsonl; avaliar com avaliar_portao.py."""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src"), str(RAIZ / "scripts")]
from avaliar import casos
from copiloto import juiz_llm


def main() -> None:
    lista = casos("dev")
    with ThreadPoolExecutor(4) as pool:
        notas = list(pool.map(lambda c: juiz_llm.triar(c["fala"], c.get("contexto") or []), lista))
    Path(sys.argv[1]).write_text("".join(json.dumps({"id": c["id"], "tipo": c["tipo"], "canal": c.get("canal"), **n}) + "\n"
                                         for c, n in zip(lista, notas, strict=True)), encoding="utf-8")
    print(f"{len(lista)} casos")


if __name__ == "__main__":
    main()
