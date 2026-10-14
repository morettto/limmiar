"""Benchmark NVIDIA's multilingual 1B Nemotron reranker on the same held-out cases."""

from __future__ import annotations

import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "nvidia/llama-nemotron-rerank-1b-v2"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {
        item["id"]: item
        for item in read(data_dir / "teste_positivos.jsonl") + read(data_dir / "teste_negativos.jsonl")
    }
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    # Screening run: equal positive/negative coverage across the three target locales.
    # Expand to all 750 only if the model merits a full run; this 60-case screen is not
    # used to claim that a production-quality 90% gate has passed.
    case_index = {case["id"]: case for case in cases.values()}
    rng = random.Random(20260929)
    chosen: set[str] = set()
    for is_positive in (True, False):
        for language in ("pt-BR", "es", "en-US"):
            pool = [
                record["id"] for record in records
                if bool(case_index[record["id"]].get("alvos")) == is_positive
                and case_index[record["id"]].get("idioma") == language
            ]
            chosen.update(rng.sample(pool, min(10, len(pool))))
    records = [record for record in records if record["id"] in chosen]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"loading {MODEL_ID}; device={device}; dtype={dtype}; cases={len(records)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True, padding_side="left")
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_ID, trust_remote_code=True, torch_dtype=dtype
    ).eval().to(device)
    if model.config.pad_token_id is None:
        model.config.pad_token_id = tokenizer.eos_token_id

    rows: list[dict] = []
    per_case_ms: list[float] = []
    for index, record in enumerate(records):
        case = cases[record["id"]]
        candidates = [
            c for c in record.get("decisao", {}).get("candidatos", [])
            if c.get("juiz", {}).get("citacao_literal")
        ]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        targets = {(t["arquivo"], int(t["pagina"])) for t in case.get("alvos", [])}
        if not candidates:
            per_case_ms.append(0.0)
            rows.append({"id": record["id"], "positive": bool(targets), "candidate_count": 0,
                         "candidate_recall": False, "ranked": [], "top1_score": None,
                         "top1_page_correct": False, "latency_ms": 0.0})
            continue

        # This exact template and score interpretation are from NVIDIA's model card.
        texts = [f"question:{query} \n \n passage:{c['juiz']['citacao_literal']}" for c in candidates]
        started = time.perf_counter()
        encoded = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with torch.inference_mode():
            scores = model(**encoded).logits.view(-1).float().cpu().tolist()
        if device == "cuda":
            torch.cuda.synchronize()
        per_case_ms.append((time.perf_counter() - started) * 1000)
        ranked = sorted(zip(scores, candidates, strict=True), key=lambda x: x[0], reverse=True)
        rows.append({
            "id": record["id"],
            "positive": bool(targets),
            "candidate_count": len(candidates),
            "candidate_recall": any((c.get("arquivo"), int(c.get("pagina", 0))) in targets for c in candidates),
            "ranked": [{"score": s, "arquivo": c.get("arquivo"), "pagina": int(c.get("pagina", 0)),
                        "paragrafo": int(c.get("paragrafo", 0)),
                        "page_correct": (c.get("arquivo"), int(c.get("pagina", 0))) in targets}
                       for s, c in ranked],
            "top1_score": ranked[0][0],
            "top1_page_correct": (ranked[0][1].get("arquivo"), int(ranked[0][1].get("pagina", 0))) in targets,
            "latency_ms": per_case_ms[-1],
        })
        if (index + 1) % 100 == 0:
            print(f"scored_cases={index + 1}/{len(records)}", flush=True)

    output = ROOT / "resultados" / "benchmark-nemotron-rerank-1b-v2-pipeline.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    positives = [r for r in rows if r["positive"]]
    negatives = [r for r in rows if not r["positive"]]
    present = [r for r in positives if r["candidate_recall"]]
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
        "pairs_per_second": sum(r["candidate_count"] for r in rows) / (sum(per_case_ms) / 1000) if per_case_ms else None,
        "output": str(output),
    }, ensure_ascii=False, indent=2), flush=True)
    for threshold in (-5, -2, 0, 2, 5, 8, 10, 12):
        accepted = [r for r in rows if r["top1_score"] is not None and r["top1_score"] >= threshold]
        correct = sum(r["positive"] and r["top1_page_correct"] for r in accepted)
        print(json.dumps({"threshold": threshold, "accepted": len(accepted),
                          "page_precision": correct / len(accepted) if accepted else 0,
                          "page_recall": correct / len(positives) if positives else 0,
                          "negative_accept_rate": sum(not r["positive"] for r in accepted) / len(negatives) if negatives else 0}), flush=True)


if __name__ == "__main__":
    main()
