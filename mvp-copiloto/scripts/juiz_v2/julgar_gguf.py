"""Juiz sim/não via llama-server (GGUF). Uso: julgar_gguf.py ENTRADA.jsonl SAIDA.jsonl [PORTA]"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from julgar_llm import RUBRICA, mensagem

SIM, NAO = {"yes", "sim"}, {"no", "não", "nao"}


def prob_sim(top: list[dict]) -> float:
    s = n = 0.0
    for t in top:
        tok = t["token"].strip().lower()
        if tok in SIM:
            s += math.exp(t["logprob"])
        elif tok in NAO:
            n += math.exp(t["logprob"])
    return s / (s + n) if s + n > 0 else float("nan")


def main() -> None:
    entrada, saida = Path(sys.argv[1]), Path(sys.argv[2])
    url = f"http://127.0.0.1:{sys.argv[3] if len(sys.argv) > 3 else 8081}/v1/chat/completions"
    rows = [json.loads(l) for l in entrada.read_text(encoding="utf-8").splitlines() if l.strip()]
    inicio = time.perf_counter()
    with saida.open("w", encoding="utf-8") as f:
        for i, r in enumerate(rows):
            corpo = {"messages": [{"role": "system", "content": RUBRICA}, {"role": "user", "content": mensagem({**r, "trecho": r["trecho"][:1600]})}],
                     "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 20}
            req = urllib.request.Request(url, json.dumps(corpo).encode(), {"Content-Type": "application/json"})
            top = json.load(urllib.request.urlopen(req, timeout=120))["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
            f.write(json.dumps({**r, "prob": prob_sim(top)}, ensure_ascii=False) + "\n")
            if i % 25 == 0:
                print(f"{i}/{len(rows)} {time.perf_counter() - inicio:.0f}s", flush=True)
    print(f"{len(rows)} pares em {time.perf_counter() - inicio:.0f} s", flush=True)


if __name__ == "__main__":
    main()
