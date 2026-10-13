"""Full 750-case test of Zen3 Reranker on the current top-10 MVP candidate pool."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "zenlm/zen3-reranker"
MAX_LENGTH = 512


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {x["id"]: x for name in ("teste_positivos.jsonl", "teste_negativos.jsonl")
             for x in read(data_dir / name)}
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"model={MODEL_ID}; device={device}; dtype={dtype}; cases={len(records)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, torch_dtype=dtype).to(device).eval()

    rows = []
    latencies = []
    for index, record in enumerate(records, 1):
        case = cases[record["id"]]
        candidates = [c for c in record.get("decisao", {}).get("candidatos", [])
                      if c.get("juiz", {}).get("citacao_literal")]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        targets = {(x["arquivo"], int(x["pagina"])) for x in case.get("alvos", [])}
        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        if not candidates:
            latencies.append(0.0)
            rows.append({"id": record["id"], "language": case["idioma"], "positive": bool(targets),
                         "candidate_count": 0, "candidate_page_recall": False, "candidate_exact_recall": False,
                         "ranked": [], "latency_ms": 0.0})
            continue

        pairs = [[query, c["juiz"]["citacao_literal"][:1800]] for c in candidates]
        started = time.perf_counter()
        encoded = tokenizer(pairs, padding=True, truncation=True, max_length=MAX_LENGTH,
                            return_tensors="pt").to(device)
        with torch.inference_mode():
            scores = model(**encoded).logits.view(-1).float().cpu().tolist()
        if device == "cuda":
            torch.cuda.synchronize()
        latency_ms = (time.perf_counter() - started) * 1000
        latencies.append(latency_ms)
        ranked = sorted(zip(scores, candidates, strict=True), key=lambda x: x[0], reverse=True)
        ranked_rows = [{
            "score": float(score), "file": c.get("arquivo"), "page": int(c.get("pagina", 0)),
            "paragraph": int(c.get("paragrafo", 0)),
            "target_page": (c.get("arquivo"), int(c.get("pagina", 0))) in targets,
            "exact_source_paragraph": (c.get("arquivo"), int(c.get("pagina", 0)),
                                       int(c.get("paragrafo", 0))) == exact,
        } for score, c in ranked]
        rows.append({
            "id": record["id"], "language": case["idioma"], "positive": bool(targets),
            "candidate_count": len(candidates),
            "candidate_page_recall": any((c.get("arquivo"), int(c.get("pagina", 0))) in targets for c in candidates),
            "candidate_exact_recall": any((c.get("arquivo"), int(c.get("pagina", 0)),
                                            int(c.get("paragrafo", 0))) == exact for c in candidates),
            "ranked": ranked_rows, "latency_ms": latency_ms,
        })
        if index % 100 == 0:
            print(f"scored_cases={index}/{len(records)}", flush=True)

    out = ROOT / "resultados" / "benchmark-zen3-reranker-pipeline.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    positives = [r for r in rows if r["positive"]]
    negatives = [r for r in rows if not r["positive"]]
    present_pages = [r for r in positives if r["candidate_page_recall"]]
    present_exact = [r for r in positives if r["candidate_exact_recall"]]
    top1_page = sum(bool(r["ranked"] and r["ranked"][0]["target_page"]) for r in positives)
    top1_exact = sum(bool(r["ranked"] and r["ranked"][0]["exact_source_paragraph"]) for r in positives)
    top5_page = sum(any(x["target_page"] for x in r["ranked"][:5]) for r in positives)
    top5_exact = sum(any(x["exact_source_paragraph"] for x in r["ranked"][:5]) for r in positives)
    print(json.dumps({
        "model": MODEL_ID, "cases": len(rows), "positive_cases": len(positives), "negative_cases": len(negatives),
        "candidate_page_recall": len(present_pages) / len(positives),
        "candidate_exact_paragraph_recall": len(present_exact) / len(positives),
        "top1_page_accuracy_all_positives": top1_page / len(positives),
        "top1_page_accuracy_if_target_candidate_present": sum(bool(r["ranked"] and r["ranked"][0]["target_page"]) for r in present_pages) / max(1, len(present_pages)),
        "top1_exact_paragraph_accuracy_all_positives": top1_exact / len(positives),
        "top1_exact_paragraph_accuracy_if_source_present": sum(bool(r["ranked"] and r["ranked"][0]["exact_source_paragraph"]) for r in present_exact) / max(1, len(present_exact)),
        "top5_page_recall": top5_page / len(positives), "top5_exact_paragraph_recall": top5_exact / len(positives),
        "p50_latency_ms_per_top10": float(np.percentile(latencies, 50)),
        "p95_latency_ms_per_top10": float(np.percentile(latencies, 95)),
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)
    for language in ("pt-BR", "es", "en-US"):
        subset = [r for r in positives if r["language"] == language]
        if not subset:
            continue
        print(json.dumps({"language": language, "positives": len(subset),
                          "top1_page_accuracy": sum(bool(r["ranked"] and r["ranked"][0]["target_page"]) for r in subset) / len(subset),
                          "top1_exact_paragraph_accuracy": sum(bool(r["ranked"] and r["ranked"][0]["exact_source_paragraph"]) for r in subset) / len(subset)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
