"""Juiz que precisa citar a frase exata da passagem. Uso: julgar_citacao.py MODELO ENTRADA.jsonl SAIDA.jsonl."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

REGRA = """You verify whether a passage from a scientific text explains what a psychotherapy patient just said.
The passage must explicitly describe the SAME experience, symptom or mechanism the patient expresses about themself in the CURRENT STATEMENT
(previous statements only resolve references). Same disorder, same population, a treatment for it, statistics, or a related-but-different
experience are NOT enough.
Reply with one JSON object and nothing else:
{"quote": "<exact sentence or clause copied from the passage that describes the patient's experience, or empty if none>", "match": true or false}
Use match=true only if the quote itself describes that experience."""


def mensagem(p: dict) -> str:
    anteriores = "\n".join(f"- {c}" for c in p.get("contexto") or []) or "(none)"
    return f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{p['fala']}\n\nPASSAGE:\n{p['trecho'][:2500]}"


def norm(t: str) -> str:
    return re.sub(r"\W+", " ", t.lower()).strip()


def ler(texto: str, trecho: str) -> float:
    try:
        r = json.loads(texto[texto.index("{"):texto.rindex("}") + 1])
    except ValueError:
        return float("nan")
    q = norm(str(r.get("quote", "")))
    return 1.0 if r.get("match") is True and len(q) > 15 and q in norm(trecho) else 0.0


def main() -> None:
    from vllm import LLM, SamplingParams

    modelo, entrada, saida = sys.argv[1:4]
    pares = [json.loads(l) for l in Path(entrada).read_text(encoding="utf-8").splitlines() if l.strip()]
    llm = LLM(model=modelo, max_model_len=4096, gpu_memory_utilization=0.92, enable_prefix_caching=True, trust_remote_code=True)
    inicio = time.perf_counter()
    r = llm.chat([[{"role": "system", "content": REGRA}, {"role": "user", "content": mensagem(p)}] for p in pares],
                 SamplingParams(max_tokens=160, temperature=0), chat_template_kwargs={"enable_thinking": False})
    seg = time.perf_counter() - inicio
    with open(saida, "w", encoding="utf-8") as f:
        for p, x in zip(pares, r, strict=True):
            f.write(json.dumps({**p, "prob_juiz": p["prob"], "prob": ler(x.outputs[0].text, p["trecho"]), "bruto": x.outputs[0].text[:300], "modelo": modelo}, ensure_ascii=False) + "\n")
    print(f"{len(pares)} pares em {seg:.0f} s", flush=True)


if __name__ == "__main__":
    main()
