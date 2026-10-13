"""Benchmark BAAI's multilingual BGE v2 M3 reranker on the held-out 750-case pipeline set."""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "modelos" / "hf" / "bge-reranker-v2-m3"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {x["id"]: x for p in ("teste_positivos.jsonl", "teste_negativos.jsonl") for x in read(data_dir / p)}
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"model={MODEL_DIR}; device={device}; dtype={dtype}; cases={len(records)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR, torch_dtype=dtype).to(device).eval()

    rows: list[dict] = []
    latencies: list[float] = []
    for index, record in enumerate(records):
        case = cases[record["id"]]
        candidates = [c for c in record.get("decisao", {}).get("candidatos", []) if c.get("juiz", {}).get("citacao_literal")]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        targets = {(x["arquivo"], int(x["pagina"])) for x in case.get("alvos", [])}
        if not candidates:
            latencies.append(0.0)
            rows.append({"id": record["id"], "positive": bool(targets), "candidate_count": 0,
                         "candidate_recall": False, "ranked": [], "top1_score": None,
                         "top1_page_correct": False, "latency_ms": 0.0})
            continue
        pairs = [[query, c["juiz"]["citacao_literal"]] for c in candidates]
        started = time.perf_counter()
        encoded = tokenizer([p[0] for p in pairs], [p[1] for p in pairs], padding=True,
                            truncation=True, max_length=512, return_tensors="pt").to(device)
        with torch.inference_mode():
            scores = model(**encoded).logits.view(-1).float().cpu().tolist()
        if device == "cuda":
            torch.cuda.synchronize()
        latencies.append((time.perf_counter() - started) * 1000)
        ranked = sorted(zip(scores, candidates, strict=True), key=lambda x: x[0], reverse=True)
        rows.append({
            "id": record["id"], "positive": bool(targets), "candidate_count": len(candidates),
            "candidate_recall": any((c.get("arquivo"), int(c.get("pagina", 0))) in targets for c in candidates),
            "ranked": [{"score": s, "arquivo": c.get("arquivo"), "pagina": int(c.get("pagina", 0)),
                        "paragrafo": int(c.get("paragrafo", 0)),
                        "page_correct": (c.get("arquivo"), int(c.get("pagina", 0))) in targets}
                       for s, c in ranked],
            "top1_score": ranked[0][0],
            "top1_probability": 1 / (1 + math.exp(-max(-60, min(60, ranked[0][0])))),
            "top1_page_correct": (ranked[0][1].get("arquivo"), int(ranked[0][1].get("pagina", 0))) in targets,
            "latency_ms": latencies[-1],
        })
        if (index + 1) % 100 == 0:
            print(f"scored_cases={index + 1}/{len(records)}", flush=True)

    out = ROOT / "resultados" / "benchmark-bge-reranker-v2-m3-pipeline.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    positives = [r for r in rows if r["positive"]]
    negatives = [r for r in rows if not r["positive"]]
    present = [r for r in positives if r["candidate_recall"]]
    print(json.dumps({
        "checkpoint": "BAAI/bge-reranker-v2-m3", "cases": len(rows),
        "positive_cases": len(positives), "negative_cases": len(negatives),
        "candidate_recall_at_10": len(present) / len(positives) if positives else 0,
        "top1_page_accuracy_all_positive": sum(r["top1_page_correct"] for r in positives) / len(positives) if positives else 0,
        "top1_page_accuracy_when_candidate_present": sum(r["top1_page_correct"] for r in present) / len(present) if present else 0,
        "p50_latency_ms_per_query": float(np.percentile(latencies, 50)) if latencies else 0,
        "p95_latency_ms_per_query": float(np.percentile(latencies, 95)) if latencies else 0,
        "pairs_per_second": sum(r["candidate_count"] for r in rows) / (sum(latencies) / 1000) if latencies else 0,
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [r for r in rows if r.get("top1_probability", -1) >= threshold]
        correct = sum(r["positive"] and r["top1_page_correct"] for r in accepted)
        print(json.dumps({"sigmoid_threshold_exploratory": threshold, "accepted": len(accepted),
                          "page_precision": correct / len(accepted) if accepted else 0,
                          "page_recall": correct / len(positives) if positives else 0,
                          "negative_accept_rate": sum(not r["positive"] for r in accepted) / len(negatives) if negatives else 0}), flush=True)


if __name__ == "__main__":
    main()
