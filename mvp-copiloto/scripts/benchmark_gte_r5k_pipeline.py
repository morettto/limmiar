"""Evaluate the existing task-trained GTE-r5k judge on the fixed held-out pipeline set."""

from __future__ import annotations

import json
import math
import sys
import time
import types
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from copiloto.treinado import reparar  # noqa: E402

MODEL_DIR = ROOT / "modelos" / "juiz-local" / "gte-r5k" / "torch"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {x["id"]: x for name in ("teste_positivos.jsonl", "teste_negativos.jsonl")
             for x in read(data_dir / name)}
    records = read(ROOT / "resultados" / "registos-teste-pipeline-treinado.jsonl")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"model={MODEL_DIR}; device={device}; cases={len(records)}; input_max_tokens=256", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_DIR, trust_remote_code=True, dtype=torch.float32
    ).to(device).eval()
    reparar(model)
    # The saved remote code targets an older Transformers API that exposed
    # get_extended_attention_mask on its base model class.
    def extended_attention_mask(self, attention_mask, input_shape):
        dtype = next(self.parameters()).dtype
        if attention_mask.dim() == 2:
            attention_mask = attention_mask[:, None, None, :]
        elif attention_mask.dim() == 3:
            attention_mask = attention_mask[:, None, :, :]
        attention_mask = attention_mask.to(dtype=dtype)
        return (1.0 - attention_mask) * torch.finfo(dtype).min

    model.new.get_extended_attention_mask = types.MethodType(extended_attention_mask, model.new)
    # This checkpoint's remote-code rotary cache is not fully moved by
    # Module.to(). Rebuild only the runtime cache on the selected device.
    for module in model.modules():
        if (hasattr(module, "_set_cos_sin_cache") and hasattr(module, "inv_freq")
                and hasattr(module, "cos_cached") and hasattr(module, "sin_cached")):
            module.inv_freq = module.inv_freq.to(device)
            module._set_cos_sin_cache(
                seq_len=module.max_seq_len_cached,
                device=device,
                dtype=module.cos_cached.dtype,
            )
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
                         "candidate_recall": False, "ranked": [], "top1_probability": None,
                         "top1_page_correct": False, "latency_ms": 0.0})
            continue
        quotes = [c["juiz"]["citacao_literal"][:900] for c in candidates]
        started = time.perf_counter()
        encoded = tokenizer([query] * len(quotes), quotes, padding=True, truncation="only_second",
                            max_length=256, return_tensors="pt").to(device)
        with torch.inference_mode():
            logits = model(**encoded).logits.view(-1).float().cpu().tolist()
        if device == "cuda":
            torch.cuda.synchronize()
        latencies.append((time.perf_counter() - started) * 1000)
        scored = [(s, c) for s, c in zip(logits, candidates, strict=True)]
        scored.sort(key=lambda x: x[0], reverse=True)
        ranked = [{"probability": 1 / (1 + math.exp(-max(-60, min(60, score)))),
                   "arquivo": c.get("arquivo"), "pagina": int(c.get("pagina", 0)),
                   "paragrafo": int(c.get("paragrafo", 0)),
                   "page_correct": (c.get("arquivo"), int(c.get("pagina", 0))) in targets}
                  for score, c in scored]
        rows.append({
            "id": record["id"], "positive": bool(targets), "candidate_count": len(candidates),
            "candidate_recall": any((c.get("arquivo"), int(c.get("pagina", 0))) in targets for c in candidates),
            "ranked": ranked, "top1_probability": ranked[0]["probability"],
            "top1_page_correct": ranked[0]["page_correct"], "latency_ms": latencies[-1],
        })
        if (index + 1) % 100 == 0:
            print(f"scored_cases={index + 1}/{len(records)}", flush=True)

    out = ROOT / "resultados" / "benchmark-gte-r5k-pipeline.jsonl"
    out.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    positives = [r for r in rows if r["positive"]]
    negatives = [r for r in rows if not r["positive"]]
    present = [r for r in positives if r["candidate_recall"]]
    print(json.dumps({"checkpoint": "gte-r5k task-trained", "cases": len(rows),
                      "positive_cases": len(positives), "negative_cases": len(negatives),
                      "candidate_recall_at_10": len(present) / len(positives),
                      "top1_page_accuracy_all_positive": sum(r["top1_page_correct"] for r in positives) / len(positives),
                      "top1_page_accuracy_when_candidate_present": sum(r["top1_page_correct"] for r in present) / len(present) if present else 0,
                      "p50_latency_ms_per_query": float(np.percentile(latencies, 50)),
                      "p95_latency_ms_per_query": float(np.percentile(latencies, 95)),
                      "output": str(out)}, ensure_ascii=False, indent=2), flush=True)
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [r for r in rows if r["top1_probability"] is not None and r["top1_probability"] >= threshold]
        correct = sum(r["positive"] and r["top1_page_correct"] for r in accepted)
        print(json.dumps({"threshold_exploratory": threshold, "accepted": len(accepted),
                          "page_precision": correct / len(accepted) if accepted else 0,
                          "page_recall": correct / len(positives),
                          "negative_accept_rate": sum(not r["positive"] for r in accepted) / len(negatives)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
