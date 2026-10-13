"""Diagnostic benchmark: rerank the full retrieved top-200 per positive query."""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import CrossEncoder

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "modelos" / "hf" / "kalm-reranker-v1-nano-r2"
INPUT = ROOT / "resultados" / "benchmark-200-top200-candidatos.jsonl"
INSTRUCTION = (
    "Determine whether the passage describes the same psychological or clinical phenomenon "
    "as the patient's experience in the query. Shared topic alone is insufficient. "
    "A match requires the same symptom, experience, or mechanism."
)


def read_rows() -> list[dict]:
    return [json.loads(line) for line in INPUT.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="queries to score (0 means all)")
    parser.add_argument("--chunk-size", type=int, default=64)
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    rows = read_rows()
    if args.limit:
        rows = rows[: args.limit]
    print(f"loading KaLM Nano R2; chunk_size={args.chunk_size}; queries={len(rows)}", flush=True)
    model = CrossEncoder(
        str(MODEL_DIR),
        trust_remote_code=True,
        device="cuda" if torch.cuda.is_available() else "cpu",
        max_length=512,
        model_kwargs={"dtype": torch.float32, "chunk_size": args.chunk_size},
    )

    pairs: list[tuple[str, str]] = []
    spans: list[tuple[int, int, int]] = []
    interactive_ms: list[float] = []
    for row_index, row in enumerate(rows):
        begin = len(pairs)
        pairs.extend((row["query"], candidate["texto"]) for candidate in row["candidates"])
        spans.append((row_index, begin, len(pairs)))

    scores: list[float] = []
    batch = args.batch_size
    started = time.perf_counter()
    for index, begin, end in spans:
        request_started = time.perf_counter()
        try:
            predicted = model.predict(
                pairs[begin:end], prompt=INSTRUCTION, batch_size=batch,
                convert_to_numpy=True, show_progress_bar=False,
            )
            scores.extend(np.asarray(predicted).reshape(-1).astype(float).tolist())
        except torch.cuda.OutOfMemoryError:
            if batch <= 1:
                raise
            torch.cuda.empty_cache()
            batch //= 2
            print(f"CUDA OOM; retry with batch_size={batch}", flush=True)
            continue
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        interactive_ms.append((time.perf_counter() - request_started) * 1000)
        if index % 5 == 4 or index + 1 == len(spans):
            print(f"scored_sessions={index + 1}/{len(spans)}; last_ms={interactive_ms[-1]:.1f}", flush=True)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    total_ms = (time.perf_counter() - started) * 1000

    output_rows = []
    page_ranks: list[int] = []
    paragraph_ranks: list[int] = []
    reciprocal_page_ranks: list[float] = []
    for row_index, begin, end in spans:
        row = rows[row_index]
        candidates = row["candidates"]
        local_scores = scores[begin:end]
        ranked_indices = sorted(range(len(local_scores)), key=local_scores.__getitem__, reverse=True)
        targets = {(target["arquivo"], int(target["pagina"])) for target in row["targets"]}
        exact = row.get("exact_source") or {}
        page_rank = next((rank for rank, i in enumerate(ranked_indices, 1)
                          if (candidates[i]["arquivo"], int(candidates[i]["pagina"])) in targets), None)
        paragraph_rank = next((rank for rank, i in enumerate(ranked_indices, 1)
                               if candidates[i]["arquivo"] == exact.get("arquivo")
                               and int(candidates[i]["pagina"]) == int(exact.get("pagina", -1))
                               and int(candidates[i]["paragrafo"]) == int(exact.get("paragrafo", -1))), None)
        if page_rank is not None:
            page_ranks.append(page_rank)
            reciprocal_page_ranks.append(1 / page_rank)
        if paragraph_rank is not None:
            paragraph_ranks.append(paragraph_rank)
        top = ranked_indices[:10]
        output_rows.append({
            "id": row["id"],
            "page_rank": page_rank,
            "exact_paragraph_rank": paragraph_rank,
            "top10": [
                {"rank": rank + 1, "arquivo": candidates[i]["arquivo"],
                 "pagina": candidates[i]["pagina"], "paragrafo": candidates[i]["paragrafo"],
                 "score": round(local_scores[i], 6), "texto": candidates[i]["texto"]}
                for rank, i in enumerate(top)
            ],
        })

    output = ROOT / "resultados" / f"benchmark-kalm-top200-r{args.chunk_size}.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in output_rows), encoding="utf-8")
    summary = {
        "queries": len(rows),
        "total_candidate_pairs": len(pairs),
        "retrieved_target_page_recall_top200": sum(row["page_rank"] is not None for row in output_rows) / len(output_rows),
        "reranked_target_page_recall_top1": sum(row["page_rank"] == 1 for row in output_rows) / len(output_rows),
        "reranked_target_page_recall_top3": sum(row["page_rank"] is not None and row["page_rank"] <= 3 for row in output_rows) / len(output_rows),
        "reranked_target_page_recall_top5": sum(row["page_rank"] is not None and row["page_rank"] <= 5 for row in output_rows) / len(output_rows),
        "reranked_target_page_recall_top10": sum(row["page_rank"] is not None and row["page_rank"] <= 10 for row in output_rows) / len(output_rows),
        "exact_paragraph_recall_top1": sum(row["exact_paragraph_rank"] == 1 for row in output_rows) / len(output_rows),
        "exact_paragraph_recall_top10": sum(row["exact_paragraph_rank"] is not None and row["exact_paragraph_rank"] <= 10 for row in output_rows) / len(output_rows),
        "page_mrr": statistics.mean(reciprocal_page_ranks) if reciprocal_page_ranks else 0,
        "interactive_session_p50_ms": float(np.percentile(interactive_ms, 50)),
        "interactive_session_p95_ms": float(np.percentile(interactive_ms, 95)),
        "serial_pairs_per_second": len(pairs) / (total_ms / 1000),
        "serial_total_ms": total_ms,
        "chunk_size": args.chunk_size,
        "batch_size": batch,
        "output": str(output),
        "warning": "200 positive diagnostic queries only; not an independent test and does not measure false-positive rate.",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
