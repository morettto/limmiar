"""Evaluate E2Rank listwise scoring on Qwen3's same 200-case top-200 pools."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "Alibaba-NLP/E2Rank-0.6B"
TASK = (
    "Given a patient's statement during a therapy session and candidate passages from "
    "psychology literature, rank passages that describe the same symptom, experience, "
    "or mechanism. Shared topic alone is insufficient."
)


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def embed(texts: list[str], tokenizer, model, device: str, max_length: int, batch_size: int) -> torch.Tensor:
    outputs = []
    for start in range(0, len(texts), batch_size):
        tokens = tokenizer(
            texts[start : start + batch_size],
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        ).to(device)
        with torch.inference_mode():
            hidden = model(**tokens).last_hidden_state
            vectors = hidden[:, -1]
            outputs.append(F.normalize(vectors.float(), p=2, dim=1).cpu())
    return torch.cat(outputs) if outputs else torch.empty((0, model.config.hidden_size))


def main() -> None:
    source = ROOT / "resultados" / "benchmark-qwen-qwen3-embedding-0.6b-retrieval-200-context.jsonl"
    rows = read(source)
    cases = {case["id"]: case for case in read(ROOT / "data" / "avaliacao" / "benchmark_200.jsonl")}
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"loading {MODEL_ID}; device={device}; cases={len(rows)}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, padding_side="left")
    model = AutoModel.from_pretrained(MODEL_ID).to(device).eval()

    unique_texts = list(dict.fromkeys(
        candidate["text"] for row in rows for candidate in row["candidates"]
    ))
    print(f"unique_candidate_passages={len(unique_texts)}", flush=True)
    started = time.perf_counter()
    doc_inputs = [text + "<|endoftext|>" for text in unique_texts]
    doc_vectors = embed(doc_inputs, tokenizer, model, device, max_length=8192, batch_size=16)
    doc_index = {text: index for index, text in enumerate(unique_texts)}
    print(f"encoded_passages={len(unique_texts)}; elapsed={time.perf_counter() - started:.1f}s", flush=True)

    prompts = []
    for row in rows:
        case = cases[row["id"]]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        docs = row["candidates"][:20]
        numbered = "\n".join(f"[{i}] {candidate['text']}" for i, candidate in enumerate(docs, 1))
        messages = [{"role": "user", "content": f"{TASK}\nDocuments:\n{numbered}\nSearch Query:{query}"}]
        prompts.append(tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        ))

    started = time.perf_counter()
    # 4,096 tokens and batch 1 keep this listwise prompt within the local 6 GiB GPU.
    query_vectors = embed(prompts, tokenizer, model, device, max_length=4096, batch_size=1)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    prompt_elapsed_ms = (time.perf_counter() - started) * 1000
    results = []
    for row_index, row in enumerate(rows):
        indices = torch.tensor([doc_index[candidate["text"]] for candidate in row["candidates"]])
        scores = doc_vectors[indices] @ query_vectors[row_index]
        order = torch.argsort(scores, descending=True).tolist()
        ranked = [row["candidates"][index] for index in order]
        targets = {(target["arquivo"], int(target["pagina"])) for target in cases[row["id"]].get("alvos", [])}
        exact = cases[row["id"]].get("fonte") or {}
        exact_target = (exact.get("arquivo"), int(exact.get("pagina", 0)), int(exact.get("paragrafo", 0)))
        results.append({
            "id": row["id"],
            "top1_page_correct": bool(ranked and (ranked[0]["file"], int(ranked[0]["page"])) in targets),
            "page_found_at_1": any((c["file"], int(c["page"])) in targets for c in ranked[:1]),
            "page_found_at_3": any((c["file"], int(c["page"])) in targets for c in ranked[:3]),
            "page_found_at_5": any((c["file"], int(c["page"])) in targets for c in ranked[:5]),
            "page_found_at_10": any((c["file"], int(c["page"])) in targets for c in ranked[:10]),
            "exact_paragraph_at_1": bool(ranked and (ranked[0]["file"], int(ranked[0]["page"]), int(ranked[0]["paragraph"])) == exact_target),
            "exact_paragraph_at_10": any((c["file"], int(c["page"]), int(c["paragraph"])) == exact_target for c in ranked[:10]),
            "ranked": [{
                "file": c["file"], "page": c["page"], "paragraph": c["paragraph"],
                "score": round(float(scores[index]), 6),
            } for index, c in zip(order[:10], ranked[:10], strict=True)],
        })

    output = ROOT / "resultados" / "benchmark-e2rank-qwen-top200.jsonl"
    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in results), encoding="utf-8")
    summary = {"checkpoint": MODEL_ID, "cases": len(results), "unique_passages": len(unique_texts)}
    for metric in ("top1_page_correct", "page_found_at_1", "page_found_at_3", "page_found_at_5", "page_found_at_10", "exact_paragraph_at_1", "exact_paragraph_at_10"):
        summary[metric] = sum(row[metric] for row in results) / len(results) if results else 0
    summary["query_batch_elapsed_ms"] = round(prompt_elapsed_ms, 2)
    summary["mean_query_encoder_ms"] = round(prompt_elapsed_ms / len(results), 2) if results else 0
    summary["output"] = str(output)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
