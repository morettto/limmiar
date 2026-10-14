"""Compara rerankers cross-encoder no mesmo pool de candidatos do Limmiar."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]


def lines(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("uso: python scripts/benchmark_pair_rerank_listwise.py <model_dir> <name>")
    model_path = Path(sys.argv[1])
    name = sys.argv[2]
    positives = lines(ROOT / "data" / "avaliacao" / "dev_positivos.jsonl")
    candidates = lines(ROOT / "data" / "avaliacao" / "dev_pares.jsonl")
    by_query: dict[str, list[dict]] = {}
    for candidate in candidates:
        by_query.setdefault(candidate["id"], []).append(candidate)
    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(model_path, trust_remote_code=True, dtype=torch.float32)
    model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    rows: list[dict] = []
    for index, positive in enumerate(positives, 1):
        pool = by_query[positive["id"]]
        target = positive["fonte"]
        target_key = (target["arquivo"], int(target["pagina"]), int(target["paragrafo"]))
        query = " ".join(positive.get("contexto", [])[-5:] + [positive["fala"]])
        start = time.perf_counter()
        encoded = tokenizer([query] * len(pool), [item["trecho"] for item in pool], truncation=True, max_length=1024, padding=True, return_tensors="pt").to(device)
        with torch.no_grad():
            logits = model(**encoded).logits.float()
        if logits.shape[-1] == 1:
            scores = torch.sigmoid(logits[:, 0])
        else:
            scores = torch.softmax(logits, dim=-1)[:, -1]
        order = torch.argsort(scores, descending=True).tolist()
        rank = next((position for position, row_index in enumerate(order, 1) if (pool[row_index]["arquivo"], int(pool[row_index]["pagina"]), int(pool[row_index]["paragrafo"])) == target_key), None)
        rows.append({"id": positive["id"], "rank": rank, "candidates": len(pool), "ms": (time.perf_counter() - start) * 1000})
        if index % 25 == 0:
            print(f"{index}/{len(positives)}", flush=True)
    ranks = [row["rank"] for row in rows if row["rank"] is not None]
    latency = sorted(row["ms"] for row in rows)
    output = ROOT / "resultados" / f"benchmark-{name}-listwise.jsonl"
    output.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    print(json.dumps({"name": name, "queries": len(rows), "top1": sum(rank <= 1 for rank in ranks) / len(rows), "top3": sum(rank <= 3 for rank in ranks) / len(rows), "top5": sum(rank <= 5 for rank in ranks) / len(rows), "mrr": sum(1 / rank for rank in ranks) / len(rows), "p50_ms": latency[len(latency) // 2], "p95_ms": latency[int(len(latency) * .95)]}))


if __name__ == "__main__":
    main()
