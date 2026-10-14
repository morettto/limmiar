"""Reescreve a fala do paciente como fenômeno clínico acadêmico. Uso: reescrever.py MODELO SAIDA.json."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "scripts"), str(RAIZ / "src")]
from avaliar import casos

from copiloto.juiz_llm import REESCRITA as PROMPT


def mensagem(c: dict) -> str:
    anteriores = "\n".join(f"- {x}" for x in c.get("contexto") or []) or "(none)"
    return f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{c['fala']}"


def separar(texto: str) -> list[str]:
    linhas = [l.split(":", 1)[1].strip() for l in texto.splitlines() if l[:3] in ("PT:", "EN:", "ES:") and ":" in l]
    return [] if texto.strip().upper().startswith("NONE") else linhas


def main() -> None:
    from vllm import LLM, SamplingParams

    modelo, saida = sys.argv[1:3]
    lista = casos("dev")
    llm = LLM(model=modelo, max_model_len=4096, gpu_memory_utilization=0.9, enable_prefix_caching=True, trust_remote_code=True)
    conversas = [[{"role": "system", "content": PROMPT}, {"role": "user", "content": mensagem(c)}] for c in lista]
    inicio = time.perf_counter()
    respostas = llm.chat(conversas, SamplingParams(max_tokens=260, temperature=0), chat_template_kwargs={"enable_thinking": False})
    segundos = time.perf_counter() - inicio
    Path(saida).write_text(json.dumps({c["id"]: separar(r.outputs[0].text) for c, r in zip(lista, respostas, strict=True)},
                                      ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(lista)} reescritas em {segundos:.0f} s", flush=True)


if __name__ == "__main__":
    main()
