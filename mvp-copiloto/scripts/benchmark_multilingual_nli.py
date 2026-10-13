"""Evaluate a multilingual NLI model as a text-only bibliographic judge."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"


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
    print(f"loading {MODEL_ID}; device={device}; cases={len(records)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID).to(device).eval()
    id2label = {int(key): value.lower() for key, value in model.config.id2label.items()}
    entailment_id = next(index for index, label in id2label.items() if "entail" in label)
    print(f"labels={id2label}; entailment_id={entailment_id}", flush=True)

    rows = []
    flat_pairs: list[tuple[str, str]] = []
    flat_refs: list[tuple[int, dict]] = []
    row_meta = []
    for record in records:
        case = cases[record["id"]]
        decision = record.get("decisao", {})
        candidates = [candidate for candidate in decision.get("candidatos", []) if candidate.get("juiz", {}).get("citacao_literal")]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        positives = {(target["arquivo"], int(target["pagina"])) for target in case.get("alvos", [])}
        row_meta.append({"id": record["id"], "positive": bool(positives), "targets": positives, "candidate_count": len(candidates)})
        row_index = len(row_meta) - 1
        for candidate in candidates:
            # NLI premise: bibliographic evidence. Hypothesis: patient's experience.
            # No speaker identity, role, voice data, or account metadata is included.
            premise = candidate["juiz"]["citacao_literal"]
            hypothesis = query
            flat_pairs.append((premise, hypothesis))
            flat_refs.append((row_index, candidate))

    started = time.perf_counter()
    scores: list[float] = []
    batch_size = 32
    for start in range(0, len(flat_pairs), batch_size):
        batch = flat_pairs[start : start + batch_size]
        encoded = tokenizer(
            [pair[0] for pair in batch],
            [pair[1] for pair in batch],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
        ).to(device)
        with torch.inference_mode():
            logits = model(**encoded).logits
            probabilities = torch.softmax(logits.float(), dim=-1)[:, entailment_id]
        scores.extend(probabilities.cpu().tolist())
        if (start // batch_size + 1) % 10 == 0:
            print(f"scored_pairs={min(start + batch_size, len(flat_pairs))}/{len(flat_pairs)}", flush=True)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    elapsed_ms = (time.perf_counter() - started) * 1000

    ranked_by_row: list[list[tuple[float, dict]]] = [[] for _ in row_meta]
    for score, (row_index, candidate) in zip(scores, flat_refs, strict=True):
        ranked_by_row[row_index].append((score, candidate))
    for meta, ranked in zip(row_meta, ranked_by_row, strict=True):
        ranked.sort(key=lambda item: item[0], reverse=True)
        top = ranked[0] if ranked else None
        meta["ranked"] = [
            {
                "score": score,
                "arquivo": candidate.get("arquivo"),
                "pagina": int(candidate.get("pagina", 0)),
                "paragrafo": int(candidate.get("paragrafo", 0)),
                "page_correct": (candidate.get("arquivo"), int(candidate.get("pagina", 0))) in meta["targets"],
            }
            for score, candidate in ranked
        ]
        meta["top1_score"] = top[0] if top else 0.0
        meta["top1_page_correct"] = bool(
            top and (top[1].get("arquivo"), int(top[1].get("pagina", 0))) in meta["targets"]
        )
        del meta["targets"]

    output = ROOT / "resultados" / "benchmark-mdeberta-mnli-pipeline.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in row_meta), encoding="utf-8")
    positive = [row for row in row_meta if row["positive"]]
    negative = [row for row in row_meta if not row["positive"]]
    summary = {
        "checkpoint": MODEL_ID,
        "cases": len(row_meta),
        "positive_cases": len(positive),
        "negative_cases": len(negative),
        "scored_pairs": len(flat_pairs),
        "positive_top1_page_accuracy": sum(row["top1_page_correct"] for row in positive) / len(positive) if positive else 0,
        "p50_pair_score": float(np.percentile(scores, 50)) if scores else 0,
        "p95_pair_score": float(np.percentile(scores, 95)) if scores else 0,
        "elapsed_ms_all_pairs": round(elapsed_ms, 2),
        "pairs_per_second": len(flat_pairs) / (elapsed_ms / 1000) if elapsed_ms else 0,
        "batch_size": batch_size,
        "output": str(output),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    for k in (1, 3, 5, 10):
        found = sum(any(candidate["page_correct"] for candidate in row["ranked"][:k]) for row in positive)
        print(json.dumps({"page_recall_at_k": k, "found": found, "total_positive": len(positive), "recall": found / len(positive) if positive else 0}), flush=True)
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [row for row in row_meta if row["ranked"] and row["top1_score"] >= threshold]
        correct = sum(row["positive"] and row["top1_page_correct"] for row in accepted)
        print(json.dumps({
            "threshold": threshold,
            "cards": len(accepted),
            "page_precision": correct / len(accepted) if accepted else 0,
            "page_recall": correct / len(positive) if positive else 0,
            "negative_rate": sum(not row["positive"] for row in accepted) / len(negative) if negative else 0,
        }), flush=True)


if __name__ == "__main__":
    main()
