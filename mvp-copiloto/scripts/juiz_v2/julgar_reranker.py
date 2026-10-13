"""Rerankers sem ajuste nas nossas obras. Uso: julgar_reranker.py MODELO ENTRADA.jsonl SAIDA.jsonl."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

INSTRUCAO = ("Given a patient's current statement in a therapy session (previous statements only resolve references), "
             "judge whether the passage explicitly describes the same clinical phenomenon the patient expresses about themself")


def consulta(par: dict) -> str:
    anteriores = " / ".join(par.get("contexto") or [])
    return f"{anteriores} || {par['fala']}" if anteriores else par["fala"]


def qwen(modelo: str, pares: list[dict]) -> list[float]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(modelo, padding_side="left")
    llm = AutoModelForCausalLM.from_pretrained(modelo, dtype=torch.float16).cuda().eval()
    prefixo = ("<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. "
               "Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n")
    sufixo = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
    sim, nao = tok.convert_tokens_to_ids("yes"), tok.convert_tokens_to_ids("no")
    notas = []
    with torch.inference_mode():
        for i in range(0, len(pares), 16):
            textos = [f"{prefixo}<Instruct>: {INSTRUCAO}\n<Query>: {consulta(p)}\n<Document>: {p['trecho'][:2500]}{sufixo}" for p in pares[i:i + 16]]
            enc = tok(textos, padding=True, truncation=True, max_length=4096, return_tensors="pt").to("cuda")
            logits = llm(**enc).logits[:, -1, [nao, sim]].float()
            notas += torch.softmax(logits, dim=-1)[:, 1].tolist()
    return notas


def jina(modelo: str, pares: list[dict]) -> list[float]:
    import torch
    from transformers import AutoModel

    m = AutoModel.from_pretrained(modelo, dtype=torch.float16, trust_remote_code=True).cuda().eval()
    notas = []
    for p in pares:
        notas.append(float(m.rerank(f"{INSTRUCAO}: {consulta(p)}", [p["trecho"][:2500]])[0]["relevance_score"]))
    return notas


def main() -> None:
    modelo, entrada, saida = sys.argv[1:4]
    pares = [json.loads(l) for l in Path(entrada).read_text(encoding="utf-8").splitlines() if l.strip()]
    inicio = time.perf_counter()
    notas = jina(modelo, pares) if "jina" in modelo else qwen(modelo, pares)
    segundos = time.perf_counter() - inicio
    with open(saida, "w", encoding="utf-8") as f:
        for p, n in zip(pares, notas, strict=True):
            f.write(json.dumps({**p, "prob": n, "modelo": modelo}, ensure_ascii=False) + "\n")
    print(f"{len(pares)} pares em {segundos:.0f} s ({segundos / len(pares) * 1000:.0f} ms/par)", flush=True)


if __name__ == "__main__":
    main()
