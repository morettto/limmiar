"""Mede o Jina v3.5 como reranker listwise sobre candidatos do Limmiar."""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path

import torch
from transformers import AutoModel

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "modelos" / "hf" / "jina-reranker-v3.5"


def lines(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def main() -> None:
    positives = lines(ROOT / "data" / "avaliacao" / "dev_positivos.jsonl")
    candidates = lines(ROOT / "data" / "avaliacao" / "dev_pares.jsonl")
    by_query: dict[str, list[dict]] = {}
    for candidate in candidates:
        by_query.setdefault(candidate["id"], []).append(candidate)
    model = AutoModel.from_pretrained(MODEL, dtype="auto", trust_remote_code=True)
    model.eval()
    if torch.cuda.is_available():
        model.cuda()

    rows: list[dict] = []
    for index, positive in enumerate(positives, 1):
        docs = by_query.get(positive["id"], [])
        target = positive["fonte"]
        target_key = (target["arquivo"], int(target["pagina"]), int(target["paragrafo"]))
        usable = [candidate for candidate in docs if candidate.get("trecho")]
        if not usable:
            rows.append({"id": positive["id"], "rank": None, "candidates": 0, "ms": 0})
            continue
        query = " ".join(positive.get("contexto", [])[-5:] + [positive["fala"]])
        start = time.perf_counter()
        ranked = model.rerank(query, [candidate["trecho"] for candidate in usable])
        elapsed = (time.perf_counter() - start) * 1000
        rank = None
        top_score = None
        for position, result in enumerate(ranked, 1):
            candidate = usable[int(result["index"])]
            if (candidate["arquivo"], int(candidate["pagina"]), int(candidate["paragrafo"])) == target_key:
                rank = position
                break
        if ranked:
            top_score = float(ranked[0]["relevance_score"])
        rows.append({"id": positive["id"], "rank": rank, "candidates": len(usable), "top_score": top_score, "ms": elapsed})
        if index % 25 == 0:
            print(f"{index}/{len(positives)}", flush=True)

    valid = [row for row in rows if row["rank"] is not None]
    ranks = [row["rank"] for row in valid]
    latency = sorted(row["ms"] for row in rows)
    output = ROOT / "resultados" / "benchmark-jina35-listwise.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    print(json.dumps({
        "queries": len(rows),
        "target_in_candidates": len(valid) / len(rows),
        "top1": sum(rank <= 1 for rank in ranks) / len(rows),
        "top3": sum(rank <= 3 for rank in ranks) / len(rows),
        "top5": sum(rank <= 5 for rank in ranks) / len(rows),
        "mrr": sum(1 / rank for rank in ranks) / len(rows),
        "p50_ms": latency[len(latency) // 2],
        "p95_ms": latency[int(len(latency) * 0.95)],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
