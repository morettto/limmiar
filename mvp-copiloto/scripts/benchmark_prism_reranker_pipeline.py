"""Benchmark Prism-Qwen3.5-Reranker on the same held-out 750-case pipeline."""

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
MODEL_DIR = ROOT / "modelos" / "hf" / "Prism-Qwen3.5-Reranker-0.8B"
INSTRUCTION = (
    "Determine whether the passage describes the same psychological or clinical phenomenon "
    "as the patient's experience in the query. Shared topic alone is insufficient. "
    "A match requires the same symptom, experience, or mechanism."
)


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()
    data_dir = ROOT / "data" / "avaliacao"
    cases = {
        item["id"]: item
        for item in read(data_dir / "teste_positivos.jsonl") + read(data_dir / "teste_negativos.jsonl")
    }
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    if args.limit:
        records = records[: args.limit]
    print(f"loading Prism checkpoint={MODEL_DIR}; device={'cuda' if torch.cuda.is_available() else 'cpu'}; cases={len(records)}", flush=True)
    model = CrossEncoder(
        str(MODEL_DIR),
        device="cuda" if torch.cuda.is_available() else "cpu",
        max_length=512,
        model_kwargs={"torch_dtype": torch.float32},
    )

    rows = []
    latencies = []
    pair_total = 0
    for index, record in enumerate(records, 1):
        case = cases[record["id"]]
        decision = record.get("decisao", {})
        candidates = [
            candidate for candidate in decision.get("candidatos", [])
            if candidate.get("juiz", {}).get("citacao_literal")
        ]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        pairs = [(query, candidate["juiz"]["citacao_literal"]) for candidate in candidates]
        started = time.perf_counter()
        if pairs:
            scores = model.predict(
                pairs,
                batch_size=args.batch_size,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            scores = np.asarray(scores).reshape(-1).astype(float).tolist()
        else:
            scores = []
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        elapsed = (time.perf_counter() - started) * 1000
        latencies.append(elapsed)
        pair_total += len(pairs)
        positives = {(target["arquivo"], int(target["pagina"])) for target in case.get("alvos", [])}
        ranked = sorted(range(len(scores)), key=scores.__getitem__, reverse=True)
        top = ranked[0] if ranked else None
        top_candidate = candidates[top] if top is not None else None
        top_page_correct = bool(
            top_candidate
            and (top_candidate.get("arquivo"), int(top_candidate.get("pagina", 0))) in positives
        )
        rows.append({
            "id": record["id"],
            "positive": bool(positives),
            "score": float(scores[top]) if top is not None else 0.0,
            "top1_page_correct": top_page_correct,
            "latency_ms": round(elapsed, 2),
            "candidate_count": len(candidates),
        })
        if index % 10 == 0 or index == len(records):
            print(f"scored={index}/{len(records)}; last_session_ms={elapsed:.1f}", flush=True)

    output = ROOT / "resultados" / "benchmark-prism-qwen35-08b-pipeline.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    positives = [row for row in rows if row["positive"]]
    negatives = [row for row in rows if not row["positive"]]
    latency_sorted = sorted(latencies)
    summary = {
        "checkpoint": "infgrad/Prism-Qwen3.5-Reranker-0.8B@c60729783cb2f0662c0b054a02964402a211e3f4",
        "cases": len(rows),
        "positive": len(positives),
        "negative": len(negatives),
        "positive_top1_page_accuracy": sum(row["top1_page_correct"] for row in positives) / len(positives) if positives else 0,
        "p50_session_latency_ms": float(np.percentile(latencies, 50)) if latencies else 0,
        "p95_session_latency_ms": float(np.percentile(latencies, 95)) if latencies else 0,
        "sessions_over_1s": sum(value > 1000 for value in latencies),
        "scored_pairs_per_second": pair_total / (sum(latencies) / 1000) if sum(latencies) else 0,
        "batch_size": args.batch_size,
        "output": str(output),
        "warning": "If --limit was used, these are diagnostic only; full test threshold evaluation requires the complete 750 cases.",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [row for row in rows if row["score"] >= threshold]
        correct = sum(row["positive"] and row["top1_page_correct"] for row in accepted)
        print(json.dumps({
            "threshold": threshold,
            "cards": len(accepted),
            "page_precision": correct / len(accepted) if accepted else 0,
            "page_recall": correct / len(positives) if positives else 0,
            "negative_rate": sum(not row["positive"] for row in accepted) / len(negatives) if negatives else 0,
        }), flush=True)


if __name__ == "__main__":
    main()
