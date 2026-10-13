"""Benchmark the 2026 KaLM Nano R2 reranker on the saved 750-case MVP pipeline."""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import CrossEncoder

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "modelos" / "hf" / "kalm-reranker-v1-nano-r2"
INSTRUCTION = (
    "Determine whether the passage describes the same psychological or clinical phenomenon "
    "as the patient's experience in the query. Shared topic alone is insufficient. "
    "A match requires the same symptom, experience, or mechanism."
)


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def percentile(values: list[float], p: float) -> float:
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * p))]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {
        item["id"]: item
        for item in read(data_dir / "teste_positivos.jsonl") + read(data_dir / "teste_negativos.jsonl")
    }
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    print(f"loading model from {MODEL_DIR}", flush=True)
    model = CrossEncoder(
        str(MODEL_DIR),
        trust_remote_code=True,
        device="cuda" if torch.cuda.is_available() else "cpu",
        max_length=512,
        model_kwargs={"dtype": torch.float32, "chunk_size": 4},
    )

    items: list[dict] = []
    pairs: list[tuple[str, str]] = []
    refs: list[tuple[int, int]] = []
    for record in records:
        case = cases[record["id"]]
        candidates = [candidate for candidate in record.get("decisao", {}).get("candidatos", []) if candidate.get("juiz", {}).get("citacao_literal")]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        case_index = len(items)
        item_start = len(pairs)
        items.append({"record": record, "case": case, "candidates": candidates, "query": query, "scores": [float("-inf")] * len(candidates), "start": item_start})
        for candidate_index, candidate in enumerate(candidates):
            pairs.append((query, candidate["juiz"]["citacao_literal"]))
            refs.append((case_index, candidate_index))
        items[-1]["end"] = len(pairs)

    def predict(sample_pairs: list[tuple[str, str]], batch_size: int = 32) -> list[float]:
        values = model.predict(
            sample_pairs,
            prompt=INSTRUCTION,
            batch_size=batch_size,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return np.asarray(values).reshape(-1).astype(float).tolist()

    interactive_ms: list[float] = []
    for item in items[:30]:
        if not item["candidates"]:
            continue
        start = time.perf_counter()
        predict(pairs[item["start"]:item["end"]])
        interactive_ms.append((time.perf_counter() - start) * 1000)
    print(f"interactive latency sample: {len(interactive_ms)} sessions", flush=True)

    batch_size = 32
    batch_count = (len(pairs) + batch_size - 1) // batch_size
    offset = 0
    batch_number = 0
    started = time.perf_counter()
    while offset < len(pairs):
        end = min(offset + batch_size, len(pairs))
        try:
            values = predict(pairs[offset:end], batch_size=batch_size)
        except torch.cuda.OutOfMemoryError:
            if batch_size <= 4:
                raise
            torch.cuda.empty_cache()
            batch_size //= 2
            batch_count = (len(pairs) + batch_size - 1) // batch_size
            print(f"GPU OOM; reducing batch to {batch_size}", flush=True)
            continue
        for (case_index, candidate_index), score in zip(refs[offset:end], values):
            items[case_index]["scores"][candidate_index] = score
        offset = end
        batch_number += 1
        if batch_number % 10 == 0 or offset == len(pairs):
            print(f"scored {offset}/{len(pairs)} pairs in {batch_number}/{batch_count} batches", flush=True)

    total_ms = (time.perf_counter() - started) * 1000
    rows: list[dict] = []
    for item in items:
        record, case, candidates = item["record"], item["case"], item["candidates"]
        if not candidates:
            rows.append({"id": record["id"], "positive": bool(case.get("alvos")), "score": 0.0, "top_correct_page": False})
            continue
        top_index = max(range(len(item["scores"])), key=item["scores"].__getitem__)
        top_candidate = candidates[top_index]
        targets = {(target["arquivo"], int(target["pagina"])) for target in case.get("alvos", [])}
        top_key = (top_candidate.get("arquivo"), int(top_candidate.get("pagina", 0)))
        rows.append({
            "id": record["id"],
            "positive": bool(case.get("alvos")),
            "score": float(item["scores"][top_index]),
            "top_correct_page": top_key in targets,
        })

    output = ROOT / "resultados" / "benchmark-kalm-nano-r2-pipeline.jsonl"
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
        "batched_pairs_per_second": len(pairs) / (total_ms / 1000),
        "all_candidates_batched_ms": total_ms,
        "batch_size": batch_size,
        "num_pairs": len(pairs),
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
