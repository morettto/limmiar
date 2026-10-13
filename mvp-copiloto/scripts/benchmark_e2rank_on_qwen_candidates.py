"""Screen E2Rank listwise embedding reranking on stratified Qwen top-200 pools."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
TOP200 = ROOT / "resultados" / "benchmark-qwen3-embedding-0.6b-pipeline-test-top200-context.jsonl"
MODEL_ID = "Alibaba-NLP/E2Rank-0.6B"
SAMPLE_PER_STRATUM = 10
TOP_K = 200
LISTWISE_K = 20
DOC_BATCH = 16
QUERY_MAX_LENGTH = 4096
DOC_MAX_LENGTH = 512
TASK = (
    "Given a person's statement in a conversation and candidate passages from psychology literature, "
    "rank passages that describe the same experience, symptom, or mechanism. Shared topic alone is insufficient."
)


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def encode(texts: list[str], tokenizer, model, device: str, max_length: int, batch_size: int) -> torch.Tensor:
    vectors = []
    for start in range(0, len(texts), batch_size):
        tokens = tokenizer(texts[start:start + batch_size], padding=True, truncation=True,
                           max_length=max_length, return_tensors="pt").to(device)
        with torch.inference_mode():
            hidden = model(**tokens).last_hidden_state
            vectors.append(F.normalize(hidden[:, -1].float(), p=2, dim=1).cpu())
    return torch.cat(vectors) if vectors else torch.empty((0, model.config.hidden_size))


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
    print(f"model={MODEL_ID}; cases={len(selected)}; candidates={TOP_K}; device={device}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, padding_side="left")
    model = AutoModel.from_pretrained(MODEL_ID, torch_dtype=torch.float16 if device == "cuda" else torch.float32).to(device).eval()
    texts = list(dict.fromkeys(c["text"] for row in selected for c in row["candidates"][:TOP_K]))
    print(f"unique_passages={len(texts)}", flush=True)
    start = time.perf_counter()
    doc_vectors = encode([t + "<|endoftext|>" for t in texts], tokenizer, model, device, DOC_MAX_LENGTH, DOC_BATCH)
    doc_index = {t: i for i, t in enumerate(texts)}
    print(f"passage_embedding_s={time.perf_counter() - start:.1f}", flush=True)

    query_inputs = []
    exact_queries = []
    for row in selected:
        case = cases[row["id"]]
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        candidates = row["candidates"][:LISTWISE_K]
        docs = "\n".join(f"[{i}] {c['text']}" for i, c in enumerate(candidates, 1))
        message = [{"role": "user", "content": f"{TASK}\nDocuments:\n{docs}\nSearch Query:{query}"}]
        query_inputs.append(tokenizer.apply_chat_template(message, tokenize=False, add_generation_prompt=True,
                                                          enable_thinking=False))
        exact_queries.append(query)
    start = time.perf_counter()
    query_vectors = encode(query_inputs, tokenizer, model, device, QUERY_MAX_LENGTH, 1)
    if device == "cuda":
        torch.cuda.synchronize()
    query_elapsed = (time.perf_counter() - start) * 1000

    results = []
    for row_index, row in enumerate(selected):
        case = cases[row["id"]]
        targets = {(x["arquivo"], int(x["pagina"])) for x in case.get("alvos", [])}
        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        candidates = row["candidates"][:TOP_K]
        indices = torch.tensor([doc_index[c["text"]] for c in candidates])
        scores = doc_vectors[indices] @ query_vectors[row_index]
        order = torch.argsort(scores, descending=True).tolist()
        ranked = [candidates[i] for i in order]
        exact_present = any((c["file"], int(c["page"]), int(c["paragraph"])) == exact for c in candidates)
        results.append({
            "id": row["id"], "language": row["language"], "positive": bool(targets),
            "exact_source_paragraph_in_top200": exact_present,
            "top1_target_page": bool(ranked and (ranked[0]["file"], int(ranked[0]["page"])) in targets),
            "top1_exact_source_paragraph": bool(ranked and (ranked[0]["file"], int(ranked[0]["page"]), int(ranked[0]["paragraph"])) == exact),
            "top10_target_page": any((c["file"], int(c["page"])) in targets for c in ranked[:10]),
            "top10_exact_source_paragraph": any((c["file"], int(c["page"]), int(c["paragraph"])) == exact for c in ranked[:10]),
            "top1_score": float(scores[order[0]]) if order else None,
        })
        if (row_index + 1) % 10 == 0:
            print(f"ranked_cases={row_index + 1}/{len(selected)}", flush=True)

    out = ROOT / "resultados" / "benchmark-e2rank-on-qwen-top200-screening.jsonl"
    out.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in results), encoding="utf-8")
    positives = [r for r in results if r["positive"]]
    negatives = [r for r in results if not r["positive"]]
    print(json.dumps({
        "model": MODEL_ID, "sample_cases": len(results), "candidate_pool": TOP_K,
        "listwise_prompt_docs": LISTWISE_K, "positive_cases": len(positives), "negative_cases": len(negatives),
        "exact_source_paragraph_recall_top200": sum(r["exact_source_paragraph_in_top200"] for r in positives) / len(positives),
        "top1_target_page_accuracy": sum(r["top1_target_page"] for r in positives) / len(positives),
        "top1_exact_paragraph_accuracy": sum(r["top1_exact_source_paragraph"] for r in positives) / len(positives),
        "top10_target_page_recall": sum(r["top10_target_page"] for r in positives) / len(positives),
        "top10_exact_paragraph_recall": sum(r["top10_exact_source_paragraph"] for r in positives) / len(positives),
        "query_embedding_mean_ms": query_elapsed / len(selected),
        "output": str(out),
    }, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
