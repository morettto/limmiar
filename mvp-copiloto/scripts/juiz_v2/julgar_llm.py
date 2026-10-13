"""Juiz sim/não por log-probabilidade com vLLM. Uso: julgar_llm.py MODELO ENTRADA.jsonl SAIDA.jsonl [quantizacao]."""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from copiloto.juiz_llm import RUBRICA, mensagem as _mensagem


def mensagem(par: dict) -> str:
    return _mensagem(par["fala"], par.get("contexto") or [], par["trecho"])


def prob_sim(logprobs: dict) -> float:
    sim = nao = 0.0
    for lp in logprobs.values():
        token = (lp.decoded_token or "").strip().lower()
        if token in ("yes", "sim", "sí", "si"):
            sim += math.exp(lp.logprob)
        elif token in ("no", "não", "nao"):
            nao += math.exp(lp.logprob)
    return sim / (sim + nao) if sim + nao > 0 else float("nan")


def main() -> None:
    from vllm import LLM, SamplingParams

    modelo, entrada, saida = sys.argv[1:4]
    quantizacao = sys.argv[4] if len(sys.argv) > 4 else None
    pares = [json.loads(l) for l in Path(entrada).read_text(encoding="utf-8").splitlines() if l.strip()]
    llm = LLM(model=modelo, quantization=quantizacao, max_model_len=4096, gpu_memory_utilization=0.92,
              enable_prefix_caching=True, trust_remote_code=True)
    conversas = [[{"role": "system", "content": RUBRICA}, {"role": "user", "content": mensagem(p)}] for p in pares]
    inicio = time.perf_counter()
    respostas = llm.chat(conversas, SamplingParams(max_tokens=1, temperature=0, logprobs=20),
                         chat_template_kwargs={"enable_thinking": False})
    segundos = time.perf_counter() - inicio
    with open(saida, "w", encoding="utf-8") as f:
        for p, r in zip(pares, respostas, strict=True):
            f.write(json.dumps({**p, "prob": prob_sim(r.outputs[0].logprobs[0]), "modelo": modelo}, ensure_ascii=False) + "\n")
    print(f"{len(pares)} pares em {segundos:.0f} s ({segundos / len(pares) * 1000:.0f} ms/par)", flush=True)


if __name__ == "__main__":
    main()
