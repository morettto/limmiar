"""Export the exact broad-retrieval candidate pools for the 200-case diagnostic."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from copiloto import busca, embedder
from copiloto.esquema import conectar, criar_esquema


def main() -> None:
    eval_dir = ROOT / "data" / "avaliacao"
    cases = [
        json.loads(line)
        for line in (eval_dir / "benchmark_200.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    con = conectar()
    criar_esquema(con)
    print("loading corpus index", flush=True)
    busca.INDICE.recarregar(con)
    print(f"index rows={len(busca.INDICE.ids)} model={busca.INDICE.modelo}; loading query embedder", flush=True)
    embedder.carregar(busca.INDICE.modelo)
    print("query embedder ready", flush=True)
    output = ROOT / "resultados" / "benchmark-200-top200-candidatos.jsonl"
    rows = []
    start = time.perf_counter()
    for i, case in enumerate(cases, 1):
        candidates = busca.candidatos_amplos(
            con,
            case["fala"],
            case["idioma"],
            limite=200,
            profundidade=200,
            por_obra=1000,
        )
        rows.append({
            "id": case["id"],
            "query": " ".join(case.get("contexto", [])[-5:] + [case["fala"]]),
            "positive": bool(case.get("alvos")),
            "targets": case.get("alvos", []),
            "exact_source": case.get("fonte"),
            "candidates": [
                {
                    "trecho_id": candidate.trecho_id,
                    "arquivo": candidate.arquivo,
                    "titulo": candidate.titulo,
                    "autor": candidate.autor,
                    "pagina": candidate.pagina,
                    "paragrafo": candidate.paragrafo,
                    "texto": candidate.texto,
                }
                for candidate in candidates
            ],
        })
        if i % 10 == 0:
            print(f"{i}/{len(cases)}; elapsed={time.perf_counter() - start:.1f}s", flush=True)
    output.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(f"saved={output}; cases={len(rows)}; elapsed={time.perf_counter() - start:.1f}s", flush=True)


if __name__ == "__main__":
    main()
