"""Test page-level retrieval followed by dense within-page paragraph selection."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
from copiloto import embedder
from copiloto.esquema import conectar, criar_esquema

MODEL = "Qwen/Qwen3-Embedding-0.6B"
SOURCE = ROOT / "resultados" / "benchmark-qwen3-embedding-0.6b-pipeline-test-top200-context.jsonl"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    eval_dir = ROOT / "data" / "avaliacao"
    cases = {x["id"]: x for name in ("teste_positivos.jsonl", "teste_negativos.jsonl")
             for x in read(eval_dir / name)}
    search_rows = read(SOURCE)
    con = conectar()
    criar_esquema(con)
    chunks = con.execute(
        "select o.arquivo,t.pagina,t.paragrafo,t.texto from trecho t"
        " join obra o on o.id=t.obra_id where o.status='pronto' order by t.id"
    ).fetchall()
    texts = [x["texto"] for x in chunks]
    chunk_pages = [(x["arquivo"], int(x["pagina"])) for x in chunks]
    page_to_indices: dict[tuple[str, int], list[int]] = {}
    for i, page in enumerate(chunk_pages):
        page_to_indices.setdefault(page, []).append(i)
    print(f"model={MODEL}; chunks={len(chunks)}; cases={len(search_rows)}; source=top200-page-union", flush=True)
    started = time.perf_counter()
    doc_vectors = embedder.codificar_documentos(texts, MODEL, lote=16)
    print(f"encoded_documents={len(texts)}; elapsed_s={time.perf_counter() - started:.1f}", flush=True)
    query_texts = [" ".join(cases[row["id"]].get("contexto", [])[-5:] + [cases[row["id"]]["fala"]])
                   for row in search_rows]
    started = time.perf_counter()
    query_vectors = embedder.codificar_consultas(query_texts, MODEL, lote=32)
    print(f"encoded_queries={len(query_texts)}; elapsed_s={time.perf_counter() - started:.1f}", flush=True)

    results: list[dict] = []
    for index, (row, query_vector) in enumerate(zip(search_rows, query_vectors, strict=True), 1):
        case = cases[row["id"]]
        targets = {(x["arquivo"], int(x["pagina"])) for x in case.get("alvos", [])}
        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        pages = list(dict.fromkeys((c["file"], int(c["page"])) for c in row["candidates"]))
        expanded = [i for page in pages for i in page_to_indices.get(page, [])]
        scores = doc_vectors[expanded] @ query_vector if expanded else np.empty(0, dtype=np.float32)
        order = np.argsort(-scores)
        ranked = [expanded[i] for i in order]
        exact_rank = next((r for r, i in enumerate(ranked, 1)
                           if chunk_pages[i] == exact[:2] and int(chunks[i]["paragrafo"]) == exact[2]), None)
        exact_page_rank = next((r for r, i in enumerate(ranked, 1) if chunk_pages[i] == exact[:2]), None)
        target_page_rank = next((r for r, i in enumerate(ranked, 1) if chunk_pages[i] in targets), None)
        results.append({
            "id": row["id"], "language": row["language"], "positive": row["positive"],
            "pages_after_dedup": len(pages), "expanded_paragraphs": len(expanded),
            "exact_source_page_in_retrieved_pages": exact[:2] in pages if row["positive"] else False,
            "exact_source_paragraph_available_after_page_expansion": exact_rank is not None if row["positive"] else False,
            "target_page_in_retrieved_pages": any(p in targets for p in pages),
            "target_page_top1_dense": bool(target_page_rank == 1),
            "exact_source_page_top1_dense": bool(exact_page_rank == 1) if row["positive"] else False,
            "exact_paragraph_top1_dense": bool(exact_rank == 1) if row["positive"] else False,
            "exact_paragraph_top10_dense": bool(exact_rank is not None and exact_rank <= 10) if row["positive"] else False,
            "exact_paragraph_top20_dense": bool(exact_rank is not None and exact_rank <= 20) if row["positive"] else False,
            "exact_paragraph_rank_dense": exact_rank,
        })
        if index % 100 == 0:
            print(f"scored_cases={index}/{len(search_rows)}", flush=True)

    out = ROOT / "resultados" / "benchmark-qwen-page-expansion-top200.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    positives = [r for r in results if r["positive"]]
    print(json.dumps({
        "strategy": "Qwen3+BM25 top200 chunks -> deduplicate pages -> expand every paragraph on those pages -> Qwen3 dense paragraph rank",
        "cases": len(results), "positive_cases": len(positives),
        "exact_source_page_recall_from_top200_page_union": sum(r["exact_source_page_in_retrieved_pages"] for r in positives) / len(positives),
        "exact_paragraph_recall_after_page_expansion_before_ranking": sum(r["exact_source_paragraph_available_after_page_expansion"] for r in positives) / len(positives),
        "target_page_top1_accuracy_after_expansion": sum(r["target_page_top1_dense"] for r in positives) / len(positives),
        "exact_source_page_top1_accuracy_after_expansion": sum(r["exact_source_page_top1_dense"] for r in positives) / len(positives),
        "exact_paragraph_top1_accuracy_after_expansion": sum(r["exact_paragraph_top1_dense"] for r in positives) / len(positives),
        "exact_paragraph_top10_accuracy_after_expansion": sum(r["exact_paragraph_top10_dense"] for r in positives) / len(positives),
        "exact_paragraph_top20_accuracy_after_expansion": sum(r["exact_paragraph_top20_dense"] for r in positives) / len(positives),
        "expanded_paragraphs_p50": float(np.percentile([r["expanded_paragraphs"] for r in results], 50)),
        "expanded_paragraphs_p95": float(np.percentile([r["expanded_paragraphs"] for r in results], 95)),
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)
    for lang in ("pt-BR", "es", "en-US"):
        subset = [r for r in positives if r["language"] == lang]
        print(json.dumps({"language": lang, "cases": len(subset), **{
            key: sum(r[key] for r in subset) / len(subset) if subset else 0
            for key in ("exact_source_page_in_retrieved_pages", "exact_source_paragraph_available_after_page_expansion",
                        "exact_paragraph_top1_dense", "exact_paragraph_top10_dense")
        }}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
