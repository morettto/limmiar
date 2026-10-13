"""Compare dense, BM25, and rank-fused paragraph selection within retrieved pages."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np

os.environ.setdefault("COPILOTO_CORPUS", "teste")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from copiloto import embedder, hibrido  # noqa: E402
from copiloto.esquema import conectar, criar_esquema  # noqa: E402

MODEL = "Qwen/Qwen3-Embedding-0.6B"
SOURCE = ROOT / "resultados" / "benchmark-qwen3-embedding-0.6b-pipeline-test-top200-context.jsonl"
RRF_CONSTANT = 60


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
    pages_by_index = [(x["arquivo"], int(x["pagina"])) for x in chunks]
    page_indices: dict[tuple[str, int], list[int]] = {}
    for i, page in enumerate(pages_by_index):
        page_indices.setdefault(page, []).append(i)

    print(f"model={MODEL}; chunks={len(chunks)}; cases={len(search_rows)}; RRF_k={RRF_CONSTANT}", flush=True)
    start = time.perf_counter()
    doc_vectors = embedder.codificar_documentos(texts, MODEL, lote=16)
    print(f"encoded_documents={len(texts)}; elapsed_s={time.perf_counter() - start:.1f}", flush=True)
    lexical = hibrido.IndiceLexical(texts)
    results = []
    latencies = []
    for index, row in enumerate(search_rows, 1):
        case = cases[row["id"]]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        start = time.perf_counter()
        query_vector = embedder.codificar_consultas([query], MODEL, lote=1)[0]
        pages = list(dict.fromkeys((c["file"], int(c["page"])) for c in row["candidates"]))
        expanded = [i for page in pages for i in page_indices.get(page, [])]
        dense_scores = doc_vectors[expanded] @ query_vector if expanded else np.empty(0, dtype=np.float32)
        dense_order = [expanded[i] for i in np.argsort(-dense_scores, kind="stable")]
        bm25_all = lexical.ordenar(query, len(texts))
        allowed = set(expanded)
        bm25_order = [i for i in bm25_all if i in allowed]
        fused_order = hibrido.fundir_rrf(dense_order, bm25_order, k=len(expanded), constante=RRF_CONSTANT)
        latency_ms = (time.perf_counter() - start) * 1000
        latencies.append(latency_ms)

        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        targets = {(x["arquivo"], int(x["pagina"])) for x in case.get("alvos", [])}

        def ranks(order: list[int]) -> tuple[int | None, int | None]:
            exact_rank = next((r for r, i in enumerate(order, 1)
                               if pages_by_index[i] == exact[:2]
                               and int(chunks[i]["paragrafo"]) == exact[2]), None)
            target_page_rank = next((r for r, i in enumerate(order, 1) if pages_by_index[i] in targets), None)
            return exact_rank, target_page_rank

        exact_dense, page_dense = ranks(dense_order)
        exact_bm25, page_bm25 = ranks(bm25_order)
        exact_rrf, page_rrf = ranks(fused_order)
        results.append({
            "id": row["id"], "language": row["language"], "positive": bool(targets),
            "expanded_paragraphs": len(expanded),
            "exact_paragraph_available": exact_rrf is not None if targets else False,
            "dense_top1_target_page": page_dense == 1,
            "bm25_top1_target_page": page_bm25 == 1,
            "rrf_top1_target_page": page_rrf == 1,
            "dense_exact_paragraph_rank": exact_dense,
            "bm25_exact_paragraph_rank": exact_bm25,
            "rrf_exact_paragraph_rank": exact_rrf,
            "rrf_exact_paragraph_top1": bool(exact_rrf is not None and exact_rrf <= 1) if targets else False,
            "rrf_exact_paragraph_top10": bool(exact_rrf is not None and exact_rrf <= 10) if targets else False,
            "rrf_exact_paragraph_top20": bool(exact_rrf is not None and exact_rrf <= 20) if targets else False,
            "rrf_target_page_rank": page_rrf,
            "latency_ms": latency_ms,
        })
        if index % 100 == 0:
            print(f"scored_cases={index}/{len(search_rows)}", flush=True)

    out = ROOT / "resultados" / "benchmark-qwen-page-expansion-rrf.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    positives = [r for r in results if r["positive"]]
    summary = {
        "strategy": f"Qwen3+BM25 top200 -> page expansion -> RRF(K={RRF_CONSTANT}) over dense and BM25 paragraph ranks",
        "cases": len(results), "positive_cases": len(positives),
        "exact_paragraph_candidate_recall": sum(r["exact_paragraph_available"] for r in positives) / len(positives),
        "dense_top1_target_page": sum(r["dense_top1_target_page"] for r in positives) / len(positives),
        "bm25_top1_target_page": sum(r["bm25_top1_target_page"] for r in positives) / len(positives),
        "rrf_top1_target_page": sum(r["rrf_top1_target_page"] for r in positives) / len(positives),
        "rrf_exact_paragraph_top1": sum(r["rrf_exact_paragraph_top1"] for r in positives) / len(positives),
        "rrf_exact_paragraph_top10": sum(r["rrf_exact_paragraph_top10"] for r in positives) / len(positives),
        "rrf_exact_paragraph_top20": sum(r["rrf_exact_paragraph_top20"] for r in positives) / len(positives),
        "query_pipeline_p50_ms": float(np.percentile(latencies, 50)),
        "query_pipeline_p95_ms": float(np.percentile(latencies, 95)),
        "output": str(out),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    for language in ("pt-BR", "es", "en-US"):
        subset = [r for r in positives if r["language"] == language]
        print(json.dumps({"language": language, "positive_cases": len(subset), **{
            metric: sum(r[metric] for r in subset) / len(subset) if subset else 0
            for metric in ("dense_top1_target_page", "bm25_top1_target_page", "rrf_top1_target_page",
                           "rrf_exact_paragraph_top1", "rrf_exact_paragraph_top10")
        }}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
