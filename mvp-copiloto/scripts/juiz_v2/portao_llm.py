"""Portão (3 perguntas sim/não por caso) com vLLM. Uso: portao_llm.py MODELO SAIDA.jsonl; avaliar com avaliar_portao.py."""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src"), str(RAIZ / "scripts"), str(Path(__file__).parent)]
from avaliar import casos
from copiloto.juiz_llm import PERGUNTAS, mensagem_portao
from julgar_llm import prob_sim

def main() -> None:
    from vllm import LLM, SamplingParams

    modelo, saida = sys.argv[1:3]
    lista = casos("dev")
    llm = LLM(model=modelo, max_model_len=4096, gpu_memory_utilization=0.9, enable_prefix_caching=True, trust_remote_code=True)
    conversas = [[{"role": "system", "content": PERGUNTAS[r]}, {"role": "user", "content": mensagem_portao(c["fala"], c.get("contexto") or [])}]
                 for c in lista for r in PERGUNTAS]
    r = llm.chat(conversas, SamplingParams(max_tokens=1, temperature=0, logprobs=20), chat_template_kwargs={"enable_thinking": False})
    n = len(PERGUNTAS)
    with open(saida, "w", encoding="utf-8") as f:
        for i, c in enumerate(lista):
            probs = {rotulo: prob_sim(x.outputs[0].logprobs[0]) for rotulo, x in zip(PERGUNTAS, r[i * n:(i + 1) * n], strict=True)}
            f.write(json.dumps({"id": c["id"], "tipo": c["tipo"], "canal": c.get("canal"), **probs}) + "\n")
    print(f"{len(lista)} portões", flush=True)


if __name__ == "__main__":
    main()
