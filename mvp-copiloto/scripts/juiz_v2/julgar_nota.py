"""Nota 0-9 por valor esperado das log-probabilidades. Uso: julgar_nota.py MODELO ENTRADA.jsonl SAIDA.jsonl."""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

REGRA = """You grade how well a passage from a scientific text or book explains what a psychotherapy patient just said.
Grade the PASSAGE against the CURRENT STATEMENT (previous statements only resolve references; they never add symptoms).

9 = the passage explicitly names and describes the very experience, symptom or mechanism the patient expresses.
6 = it clearly describes a closely matching experience or mechanism, missing some detail.
3 = same disorder, population or theme, but it describes a different experience.
0 = unrelated, or only a title, keywords, reference list, page header, methodology, statistics, or generic background.

Grade 0-3 when the passage only: describes a treatment or intervention, reports prevalence or correlations, defines a diagnosis
without the patient's specific experience, or concerns another person than the one the patient talks about.
Answer with a single digit from 0 to 9."""


def mensagem(p: dict) -> str:
    anteriores = "\n".join(f"- {c}" for c in p.get("contexto") or []) or "(none)"
    return f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{p['fala']}\n\nPASSAGE:\n{p['trecho'][:2500]}\n\nGrade (0-9):"


def esperado(logprobs: dict) -> float:
    pesos = {}
    for lp in logprobs.values():
        t = (lp.decoded_token or "").strip()
        if len(t) == 1 and t in "0123456789":
            pesos[int(t)] = pesos.get(int(t), 0.0) + math.exp(lp.logprob)
    total = sum(pesos.values())
    return sum(d * w for d, w in pesos.items()) / total if total > 0 else float("nan")


def main() -> None:
    from vllm import LLM, SamplingParams

    modelo, entrada, saida = sys.argv[1:4]
    pares = [json.loads(l) for l in Path(entrada).read_text(encoding="utf-8").splitlines() if l.strip()]
    llm = LLM(model=modelo, max_model_len=2560, gpu_memory_utilization=0.95, enable_prefix_caching=True, trust_remote_code=True)
    inicio = time.perf_counter()
    r = llm.chat([[{"role": "system", "content": REGRA}, {"role": "user", "content": mensagem(p)}] for p in pares],
                 SamplingParams(max_tokens=1, temperature=0, logprobs=20), chat_template_kwargs={"enable_thinking": False})
    seg = time.perf_counter() - inicio
    with open(saida, "w", encoding="utf-8") as f:
        for p, x in zip(pares, r, strict=True):
            n = esperado(x.outputs[0].logprobs[0])
            f.write(json.dumps({**p, "prob_sn": p["prob"], "nota": n, "prob": n / 9, "modelo": modelo}, ensure_ascii=False) + "\n")
    print(f"{len(pares)} pares em {seg:.0f} s", flush=True)


if __name__ == "__main__":
    main()
