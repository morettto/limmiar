"""Compare the locally trained GTE judge on the top-200 diagnostic pools."""

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from copiloto.treinado import consulta, pasta, reparar

INPUT = ROOT / "resultados" / "benchmark-200-top200-candidatos.jsonl"
MODEL_DIR = pasta("gte-r2")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=24)
    args = parser.parse_args()
    rows = [json.loads(line) for line in INPUT.read_text(encoding="utf-8").splitlines() if line.strip()][:args.limit]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"loading gte-r2 from {MODEL_DIR}; device={device}; queries={len(rows)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR, trust_remote_code=True, dtype=torch.float32)
    reparar(model)
    model.to(device).eval()

    case_by_id = {
        json.loads(line)["id"]: json.loads(line)
        for line in (ROOT / "data" / "avaliacao" / "benchmark_200.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    timings = []
    outputs = []
    for row_number, row in enumerate(rows, 1):
        case = case_by_id[row["id"]]
        query = consulta(case["fala"], case.get("contexto", []))
        candidates = row["candidates"]
        scores = []
        start = time.perf_counter()
        for offset in range(0, len(candidates), args.batch_size):
            batch = candidates[offset:offset + args.batch_size]
            encoded = tokenizer(
                [query] * len(batch), [item["texto"][:900] for item in batch],
                truncation="only_second", max_length=256, padding=True, return_tensors="pt",
            ).to(device)
            with torch.inference_mode():
                logits = model(**encoded).logits.float()
                scores.extend(torch.sigmoid(logits[:, 0]).cpu().tolist())
        if device == "cuda":
            torch.cuda.synchronize()
        timings.append((time.perf_counter() - start) * 1000)
        order = sorted(range(len(scores)), key=scores.__getitem__, reverse=True)
        targets = {(item["arquivo"], int(item["pagina"])) for item in row["targets"]}
        exact = case.get("fonte") or {}
        page_rank = next((rank for rank, i in enumerate(order, 1)
                          if (candidates[i]["arquivo"], int(candidates[i]["pagina"])) in targets), None)
        exact_rank = next((rank for rank, i in enumerate(order, 1)
                           if candidates[i]["arquivo"] == exact.get("arquivo")
                           and int(candidates[i]["pagina"]) == int(exact.get("pagina", -1))
                           and int(candidates[i]["paragrafo"]) == int(exact.get("paragrafo", -1))), None)
        outputs.append({"id": row["id"], "page_rank": page_rank, "exact_paragraph_rank": exact_rank,
                        "top10": [{"rank": rank + 1, "arquivo": candidates[i]["arquivo"],
                                   "pagina": candidates[i]["pagina"], "paragrafo": candidates[i]["paragrafo"],
                                   "score": round(scores[i], 6), "texto": candidates[i]["texto"]}
                                  for rank, i in enumerate(order[:10])]})
        if row_number % 5 == 0 or row_number == len(rows):
            print(f"scored={row_number}/{len(rows)}; last_session_ms={timings[-1]:.1f}", flush=True)

    output = ROOT / "resultados" / "benchmark-gte-r2-top200.jsonl"
    output.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in outputs), encoding="utf-8")
    summary = {
        "queries": len(outputs),
        "retrieved_target_page_recall_top200": sum(x["page_rank"] is not None for x in outputs) / len(outputs),
        "reranked_target_page_recall_top1": sum(x["page_rank"] == 1 for x in outputs) / len(outputs),
        "reranked_target_page_recall_top3": sum(x["page_rank"] is not None and x["page_rank"] <= 3 for x in outputs) / len(outputs),
        "reranked_target_page_recall_top5": sum(x["page_rank"] is not None and x["page_rank"] <= 5 for x in outputs) / len(outputs),
        "reranked_target_page_recall_top10": sum(x["page_rank"] is not None and x["page_rank"] <= 10 for x in outputs) / len(outputs),
        "exact_paragraph_recall_top1": sum(x["exact_paragraph_rank"] == 1 for x in outputs) / len(outputs),
        "exact_paragraph_recall_top10": sum(x["exact_paragraph_rank"] is not None and x["exact_paragraph_rank"] <= 10 for x in outputs) / len(outputs),
        "session_latency_p50_ms": float(np.percentile(timings, 50)),
        "session_latency_p95_ms": float(np.percentile(timings, 95)),
        "sessions_over_1s": sum(t > 1000 for t in timings),
        "output": str(output),
        "warning": "20 positive diagnostic queries; not independent final quality evidence; false-positive rate not measured.",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
