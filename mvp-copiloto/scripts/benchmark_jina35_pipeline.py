"""Testa o Jina v3.5 nos 750 pools de candidatos já gerados pelo MVP."""

from __future__ import annotations

import json
import time
from pathlib import Path

import torch
from transformers import AutoModel

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "modelos" / "hf" / "jina-reranker-v3.5"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data = ROOT / "data" / "avaliacao"
    cases = {item["id"]: item for item in read(data / "teste_positivos.jsonl") + read(data / "teste_negativos.jsonl")}
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    model = AutoModel.from_pretrained(MODEL, dtype="auto", trust_remote_code=True)
    model.eval()
    if torch.cuda.is_available():
        model.cuda()
    rows: list[dict] = []
    for index, record in enumerate(records, 1):
        case = cases[record["id"]]
        candidates = record["decisao"].get("candidatos", [])
        documents = [candidate["juiz"].get("citacao_literal", "") for candidate in candidates]
        documents = [text for text in documents if text]
        if not documents:
            rows.append({"id": record["id"], "positive": record["id"].startswith("teste-pos"), "score": 0.0, "top_correct_page": False, "ms": 0})
            continue
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        start = time.perf_counter()
        ranked = model.rerank(query, documents)
        elapsed = (time.perf_counter() - start) * 1000
        top = ranked[0]
        top_candidate = candidates[int(top["index"])]
        targets = {(target["arquivo"], int(target["pagina"])) for target in case.get("alvos", [])}
        top_key = (top_candidate.get("arquivo"), int(top_candidate.get("pagina", 0)))
        rows.append({"id": record["id"], "positive": record["id"].startswith("teste-pos"), "score": float(top["relevance_score"]), "top_correct_page": top_key in targets, "ms": elapsed})
        if index % 50 == 0:
            print(f"{index}/{len(records)}", flush=True)
    output = ROOT / "resultados" / "benchmark-jina35-pipeline.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    positive = [row for row in rows if row["positive"]]
    negative = [row for row in rows if not row["positive"]]
    latency = sorted(row["ms"] for row in rows if row["ms"])
    print(json.dumps({"rows": len(rows), "positive": len(positive), "negative": len(negative), "p50_ms": latency[len(latency)//2], "p95_ms": latency[int(len(latency)*.95)]}))
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
        accepted = [row for row in rows if row["score"] >= threshold]
        correct = sum(row["positive"] and row["top_correct_page"] for row in accepted)
        print(json.dumps({"threshold": threshold, "cards": len(accepted), "precision_page": correct / len(accepted) if accepted else 0.0, "recall_page": correct / len(positive), "negative_rate": sum(not row["positive"] for row in accepted) / len(negative)}))


if __name__ == "__main__":
    main()
