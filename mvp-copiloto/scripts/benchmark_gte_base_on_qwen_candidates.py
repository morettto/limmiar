"""Screen Alibaba GTE multilingual reranker on a stratified Qwen hybrid top-30."""

from __future__ import annotations

import json
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

TOP200 = ROOT / "resultados" / "benchmark-qwen3-embedding-0.6b-pipeline-test-top200-context.jsonl"
MODEL_ID = "Alibaba-NLP/gte-multilingual-reranker-base"
SAMPLE_PER_STRATUM = 10
TOP_K = 30
PAIR_BATCH = 16


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    data_dir = ROOT / "data" / "avaliacao"
    cases = {x["id"]: x for name in ("teste_positivos.jsonl", "teste_negativos.jsonl")
             for x in read(data_dir / name)}
    all_rows = read(TOP200)
    selected = []
    for language in ("pt-BR", "es", "en-US"):
        for positive in (True, False):
            selected.extend([r for r in all_rows if r["language"] == language and r["positive"] is positive][:SAMPLE_PER_STRATUM])

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    print(f"model={MODEL_ID}; cases={len(selected)}; top_k={TOP_K}; device={device}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_ID, trust_remote_code=True, torch_dtype=dtype
    ).to(device).eval()
    reparar(model)

    def extended_attention_mask(self, attention_mask, input_shape):
        dtype = next(self.parameters()).dtype
        if attention_mask.dim() == 2:
            attention_mask = attention_mask[:, None, None, :]
        elif attention_mask.dim() == 3:
            attention_mask = attention_mask[:, None, :, :]
        attention_mask = attention_mask.to(dtype=dtype)
        return (1.0 - attention_mask) * torch.finfo(dtype).min

    model.new.get_extended_attention_mask = types.MethodType(extended_attention_mask, model.new)
    for module in model.modules():
        if (hasattr(module, "_set_cos_sin_cache") and hasattr(module, "inv_freq")
                and hasattr(module, "cos_cached") and hasattr(module, "sin_cached")):
            module.inv_freq = module.inv_freq.to(device)
            module._set_cos_sin_cache(
                seq_len=module.max_seq_len_cached,
                device=device,
                dtype=module.cos_cached.dtype,
            )

    results = []
    latencies = []
    for ix, row in enumerate(selected, 1):
        case = cases[row["id"]]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        targets = {(t["arquivo"], int(t["pagina"])) for t in case.get("alvos", [])}
        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        candidates = row["candidates"][:TOP_K]
        scores = []
        started = time.perf_counter()
        for offset in range(0, len(candidates), PAIR_BATCH):
            batch = candidates[offset:offset + PAIR_BATCH]
            encoded = tokenizer([query] * len(batch), [c["text"] for c in batch], padding=True,
                                truncation=True, max_length=512, return_tensors="pt").to(device)
            with torch.inference_mode():
                scores.extend(model(**encoded).logits.view(-1).float().cpu().tolist())
        if device == "cuda":
            torch.cuda.synchronize()
        latency_ms = (time.perf_counter() - started) * 1000
        latencies.append(latency_ms)
        ranked = sorted(zip(scores, candidates, strict=True), key=lambda x: x[0], reverse=True)
        candidate_exact = any((c["file"], int(c["page"]), int(c["paragraph"])) == exact for c in candidates)
        top = ranked[0][1] if ranked else None
        results.append({
            "id": row["id"], "language": row["language"], "positive": bool(targets),
            "candidate_count": len(candidates), "candidate_recall_exact_paragraph": candidate_exact,
            "top1_target_page": bool(top and (top["file"], int(top["page"])) in targets),
            "top1_exact_source_paragraph": bool(top and (top["file"], int(top["page"]), int(top["paragraph"])) == exact),
            "top1_score": ranked[0][0] if ranked else None,
            "latency_ms": latency_ms,
        })
        if ix % 10 == 0:
            print(f"scored_cases={ix}/{len(selected)}", flush=True)

    out = ROOT / "resultados" / "benchmark-gte-base-on-qwen-top30-screening.jsonl"
    out.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in results), encoding="utf-8")
    positives = [r for r in results if r["positive"]]
    negatives = [r for r in results if not r["positive"]]
    print(json.dumps({
        "model": MODEL_ID, "sample_cases": len(results), "top_k": TOP_K,
        "positive_cases": len(positives), "negative_cases": len(negatives),
        "exact_source_paragraph_in_top30": sum(r["candidate_recall_exact_paragraph"] for r in positives) / len(positives),
        "top1_target_page_accuracy_over_positives": sum(r["top1_target_page"] for r in positives) / len(positives),
        "top1_target_page_accuracy_when_source_present": sum(r["top1_target_page"] for r in positives if r["candidate_recall_exact_paragraph"]) / max(1, sum(r["candidate_recall_exact_paragraph"] for r in positives)),
        "top1_exact_paragraph_accuracy_over_positives": sum(r["top1_exact_source_paragraph"] for r in positives) / len(positives),
        "p50_latency_ms_for_top30": float(np.percentile(latencies, 50)),
        "p95_latency_ms_for_top30": float(np.percentile(latencies, 95)),
        "positive_top1_score_median": float(np.median([r["top1_score"] for r in positives])),
        "negative_top1_score_median": float(np.median([r["top1_score"] for r in negatives])),
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
