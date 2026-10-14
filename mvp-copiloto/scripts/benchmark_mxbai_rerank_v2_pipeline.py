"""Benchmark mxbai-rerank-base-v2 on the saved 750-case Limmiar candidate pipeline."""

from __future__ import annotations

import json
import statistics
import sys
import time
import types
from pathlib import Path

import torch
from mxbai_rerank import MxbaiRerankV2

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "modelos" / "hf" / "mxbai-rerank-base-v2"
INSTRUCTION = (
    "Judge whether the passage describes the same psychological or clinical phenomenon "
    "as the patient's experience in the query. Shared topic alone is not enough. "
    "A match requires the same symptom, experience, or mechanism."
)


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def percentile(values: list[float], p: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * p))]


def restore_prepare_for_model(tokenizer) -> None:
    """Transformers 5 removed prepare_for_model; reproduce this Qwen2 pair operation.

    mxbai-rerank 0.1.6 calls this legacy method with add_special_tokens=False and
    truncation='only_second'. Qwen2 adds no pair separator tokens, so concatenating
    the two already-tokenized sequences and truncating only the second is equivalent.
    """
    if hasattr(tokenizer, "prepare_for_model"):
        return

    def prepare(self, ids, pair_ids=None, *, truncation=None, max_length=None, padding=False,
                return_attention_mask=False, return_token_type_ids=False, add_special_tokens=False,
                **kwargs):
        first = list(ids)
        second = list(pair_ids or [])
        if max_length is not None and len(first) + len(second) > max_length:
            if truncation != "only_second":
                raise ValueError(f"unsupported truncation mode: {truncation}")
            second = second[: max(0, max_length - len(first))]
        return {"input_ids": first + second}

    tokenizer.prepare_for_model = types.MethodType(prepare, tokenizer)


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {
        item["id"]: item
        for item in read(data_dir / "teste_positivos.jsonl") + read(data_dir / "teste_negativos.jsonl")
    }
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")

    print(f"loading model from {MODEL_DIR}", flush=True)
    model = MxbaiRerankV2(str(MODEL_DIR), device="cuda" if torch.cuda.is_available() else "cpu", max_length=1024)
    restore_prepare_for_model(model.tokenizer)
    cases_for_scoring: list[dict] = []
    flat_queries: list[str] = []
    flat_documents: list[str] = []
    flat_refs: list[tuple[int, int]] = []
    for record in records:
        case = cases[record["id"]]
        candidates = record.get("decisao", {}).get("candidatos", [])
        candidates = [candidate for candidate in candidates if candidate.get("juiz", {}).get("citacao_literal")]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        case_index = len(cases_for_scoring)
        cases_for_scoring.append({"record": record, "case": case, "candidates": candidates, "query": query, "scores": [float("-inf")] * len(candidates)})
        for candidate_index, candidate in enumerate(candidates):
            flat_queries.append(query)
            flat_documents.append(candidate["juiz"]["citacao_literal"])
            flat_refs.append((case_index, candidate_index))

    # Estimate interactive latency with 40 individual session requests, then measure
    # corpus throughput using model batches, which is the serving strategy for concurrency.
    interactive_ms: list[float] = []
    for item in cases_for_scoring[:40]:
        if not item["candidates"]:
            continue
        docs = [candidate["juiz"]["citacao_literal"] for candidate in item["candidates"]]
        start = time.perf_counter()
        model.predict([item["query"]] * len(docs), docs, instruction=INSTRUCTION, normalize=True)
        interactive_ms.append((time.perf_counter() - start) * 1000)
    print(f"interactive latency sample: {len(interactive_ms)} sessions", flush=True)

    batch_size = 24
    batch_count = (len(flat_queries) + batch_size - 1) // batch_size
    started = time.perf_counter()
    batch_number = 0
    offset = 0
    while offset < len(flat_queries):
        end = min(offset + batch_size, len(flat_queries))
        try:
            scores = model.predict(flat_queries[offset:end], flat_documents[offset:end], instruction=INSTRUCTION, normalize=True)
        except torch.cuda.OutOfMemoryError:
            if batch_size <= 4:
                raise
            torch.cuda.empty_cache()
            batch_size //= 2
            batch_count = (len(flat_queries) + batch_size - 1) // batch_size
            print(f"GPU OOM; reducing inference batch to {batch_size}", flush=True)
            continue
        for (case_index, candidate_index), score in zip(flat_refs[offset:end], scores.tolist()):
            cases_for_scoring[case_index]["scores"][candidate_index] = float(score)
        offset = end
        batch_number += 1
        if batch_number % 10 == 0 or offset == len(flat_queries):
            print(f"scored {offset}/{len(flat_queries)} pairs in {batch_number}/{batch_count} batches", flush=True)

    total_ms = (time.perf_counter() - started) * 1000
    rows: list[dict] = []
    for item in cases_for_scoring:
        record, case, candidates = item["record"], item["case"], item["candidates"]
        positive = bool(case.get("alvos"))
        if not candidates:
            rows.append({"id": record["id"], "positive": positive, "score": 0.0, "top_correct_page": False, "ms": 0.0})
            continue
        top_index = max(range(len(item["scores"])), key=item["scores"].__getitem__)
        top_candidate = candidates[top_index]
        targets = {(target["arquivo"], int(target["pagina"])) for target in case.get("alvos", [])}
        top_key = (top_candidate.get("arquivo"), int(top_candidate.get("pagina", 0)))
        rows.append({
            "id": record["id"],
            "positive": positive,
            "score": float(item["scores"][top_index]),
            "top_correct_page": top_key in targets,
            "ms": 0.0,
        })

    output = ROOT / "resultados" / "benchmark-mxbai-rerank-v2-pipeline.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    positives = [row for row in rows if row["positive"]]
    negatives = [row for row in rows if not row["positive"]]
    print(json.dumps({
        "rows": len(rows),
        "positive": len(positives),
        "negative": len(negatives),
        "top1_page_accuracy_on_positives": sum(row["top_correct_page"] for row in positives) / len(positives),
        "interactive_sample_p50_ms": percentile(interactive_ms, 0.50),
        "interactive_sample_p95_ms": percentile(interactive_ms, 0.95),
        "interactive_sample_mean_ms": statistics.mean(interactive_ms),
        "batched_pairs_per_second": len(flat_queries) / (total_ms / 1000),
        "all_candidates_batched_ms": total_ms,
        "batch_size": batch_size,
        "num_pairs": len(flat_queries),
        "output": str(output),
    }, indent=2))
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [row for row in rows if row["score"] >= threshold]
        correct = sum(row["positive"] and row["top_correct_page"] for row in accepted)
        print(json.dumps({
            "threshold": threshold,
            "cards": len(accepted),
            "precision_page": correct / len(accepted) if accepted else 0.0,
            "recall_page": correct / len(positives),
            "negative_rate": sum(not row["positive"] for row in accepted) / len(negatives),
        }))


if __name__ == "__main__":
    main()
