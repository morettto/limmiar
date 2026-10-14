"""Benchmark LAMAR as a text-only reranker on the held-out Limmiar pipeline set."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "nlpai-lab/LAMAR-600m"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {
        item["id"]: item
        for item in read(data_dir / "teste_positivos.jsonl") + read(data_dir / "teste_negativos.jsonl")
    }
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"loading {MODEL_ID}; device={device}; dtype={dtype}; cases={len(records)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, torch_dtype=dtype).to(device).eval()
    print(f"labels={model.config.id2label}; max_position_embeddings={model.config.max_position_embeddings}", flush=True)

    rows: list[dict] = []
    all_scores: list[float] = []
    per_case_ms: list[float] = []
    for index, record in enumerate(records):
        case = cases[record["id"]]
        decision = record.get("decisao", {})
        candidates = [c for c in decision.get("candidatos", []) if c.get("juiz", {}).get("citacao_literal")]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        targets = {(t["arquivo"], int(t["pagina"])) for t in case.get("alvos", [])}
        pairs = [[query, c["juiz"]["citacao_literal"]] for c in candidates]
        if not pairs:
            per_case_ms.append(0.0)
            rows.append({
                "id": record["id"],
                "positive": bool(targets),
                "candidate_count": 0,
                "candidate_recall": False,
                "ranked": [],
                "top1_score": None,
                "top1_page_correct": False,
                "latency_ms": 0.0,
            })
            continue
        started = time.perf_counter()
        encoded = tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors="pt").to(device)
        with torch.inference_mode():
            scores = model(**encoded).logits.view(-1).float().cpu().tolist()
        if device == "cuda":
            torch.cuda.synchronize()
        per_case_ms.append((time.perf_counter() - started) * 1000)
        all_scores.extend(scores)
        ranked = sorted(zip(scores, candidates, strict=True), key=lambda x: x[0], reverse=True)
        rows.append({
            "id": record["id"],
            "positive": bool(targets),
            "candidate_count": len(candidates),
            "candidate_recall": any((c.get("arquivo"), int(c.get("pagina", 0))) in targets for c in candidates),
            "ranked": [{
                "score": score,
                "arquivo": c.get("arquivo"),
                "pagina": int(c.get("pagina", 0)),
                "paragrafo": int(c.get("paragrafo", 0)),
                "page_correct": (c.get("arquivo"), int(c.get("pagina", 0))) in targets,
            } for score, c in ranked],
            "top1_score": ranked[0][0] if ranked else None,
            "top1_page_correct": bool(ranked and (ranked[0][1].get("arquivo"), int(ranked[0][1].get("pagina", 0))) in targets),
            "latency_ms": per_case_ms[-1],
        })
        if (index + 1) % 100 == 0:
            print(f"scored_cases={index + 1}/{len(records)}", flush=True)

    out = ROOT / "resultados" / "benchmark-lamar-600m-pipeline.jsonl"
    out.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    positives = [row for row in rows if row["positive"]]
    negatives = [row for row in rows if not row["positive"]]
    present = [row for row in positives if row["candidate_recall"]]
    print(json.dumps({
        "checkpoint": MODEL_ID,
        "cases": len(rows),
        "positive_cases": len(positives),
        "negative_cases": len(negatives),
        "candidate_recall_at_10": len(present) / len(positives) if positives else None,
        "top1_page_accuracy_all_positive": sum(r["top1_page_correct"] for r in positives) / len(positives) if positives else None,
        "top1_page_accuracy_when_candidate_present": sum(r["top1_page_correct"] for r in present) / len(present) if present else None,
        "p50_latency_ms_per_query": float(np.percentile(per_case_ms, 50)) if per_case_ms else None,
        "p95_latency_ms_per_query": float(np.percentile(per_case_ms, 95)) if per_case_ms else None,
        "pairs_per_second": len(all_scores) / (sum(per_case_ms) / 1000) if per_case_ms else None,
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)
    for threshold in (-5, -2, 0, 2, 5, 8, 10, 12):
        accepted = [r for r in rows if r["top1_score"] is not None and r["top1_score"] >= threshold]
        correct = sum(r["positive"] and r["top1_page_correct"] for r in accepted)
        print(json.dumps({
            "threshold": threshold,
            "accepted": len(accepted),
            "page_precision": correct / len(accepted) if accepted else 0,
            "page_recall": correct / len(positives) if positives else 0,
            "negative_accept_rate": sum(not r["positive"] for r in accepted) / len(negatives) if negatives else 0,
        }), flush=True)


if __name__ == "__main__":
    main()
