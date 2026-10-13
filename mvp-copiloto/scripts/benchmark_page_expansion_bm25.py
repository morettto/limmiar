"""Test fast BM25 selection within the pages returned by the top-200 semantic search."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from copiloto.hibrido import IndiceLexical  # noqa: E402
from copiloto.esquema import conectar, criar_esquema  # noqa: E402

SOURCE = ROOT / "resultados" / "benchmark-qwen3-embedding-0.6b-pipeline-test-top200-context.jsonl"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    eval_dir = ROOT / "data" / "avaliacao"
    cases = {x["id"]: x for name in ("teste_positivos.jsonl", "teste_negativos.jsonl")
             for x in read(eval_dir / name)}
    rows = read(SOURCE)
    con = conectar()
    criar_esquema(con)
    chunks = con.execute(
        "select o.arquivo,t.pagina,t.paragrafo,t.texto from trecho t"
        " join obra o on o.id=t.obra_id where o.status='pronto' order by t.id"
    ).fetchall()
    texts = [x["texto"] for x in chunks]
    page_keys = [(x["arquivo"], int(x["pagina"])) for x in chunks]
    lexical = IndiceLexical(texts)
    results = []
    for index, row in enumerate(rows, 1):
        case = cases[row["id"]]
        targets = {(x["arquivo"], int(x["pagina"])) for x in case.get("alvos", [])}
        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        pages = set((c["file"], int(c["page"])) for c in row["candidates"])
        allowed = set(i for i, page in enumerate(page_keys) if page in pages)
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        full_order = lexical.ordenar(query, len(texts))
        ranked = [i for i in full_order if i in allowed]
        exact_rank = next((rank for rank, i in enumerate(ranked, 1)
                           if page_keys[i] == exact[:2] and int(chunks[i]["paragrafo"]) == exact[2]), None)
        target_page_rank = next((rank for rank, i in enumerate(ranked, 1) if page_keys[i] in targets), None)
        results.append({
            "id": row["id"], "language": row["language"], "positive": row["positive"],
            "expanded_candidates": len(allowed), "target_page_top1_bm25": bool(target_page_rank == 1),
            "exact_paragraph_top1_bm25": bool(exact_rank == 1) if row["positive"] else False,
            "exact_paragraph_top10_bm25": bool(exact_rank is not None and exact_rank <= 10) if row["positive"] else False,
            "exact_paragraph_top20_bm25": bool(exact_rank is not None and exact_rank <= 20) if row["positive"] else False,
            "exact_paragraph_rank_bm25": exact_rank,
        })
        if index % 250 == 0:
            print(f"scored_cases={index}/{len(rows)}", flush=True)
    out = ROOT / "resultados" / "benchmark-page-expansion-bm25.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    positives = [r for r in results if r["positive"]]
    print(json.dumps({"strategy": "Qwen3+BM25 top200 chunks -> page union -> BM25 rank paragraphs in those pages",
                      "cases": len(results), "positive_cases": len(positives),
                      "exact_paragraph_top1": sum(r["exact_paragraph_top1_bm25"] for r in positives) / len(positives),
                      "exact_paragraph_top10": sum(r["exact_paragraph_top10_bm25"] for r in positives) / len(positives),
                      "exact_paragraph_top20": sum(r["exact_paragraph_top20_bm25"] for r in positives) / len(positives),
                      "output": str(out)}, ensure_ascii=False, indent=2), flush=True)
    for lang in ("pt-BR", "es", "en-US"):
        subset = [r for r in positives if r["language"] == lang]
        print(json.dumps({"language": lang, "cases": len(subset), **{
            f"exact_paragraph_top{k}": sum(r[f"exact_paragraph_top{k}_bm25"] for r in subset) / len(subset)
            for k in (1, 10, 20)
        }}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
