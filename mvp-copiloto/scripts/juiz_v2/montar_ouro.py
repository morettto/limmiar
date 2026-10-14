"""Pares rotulados do desenvolvimento para validar o rotulador de referência e comparar juízes."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src"), str(RAIZ / "scripts")]
import treinar
from copiloto.revisao_fontes import aplicar

DESTINO = RAIZ / "data" / "juiz-v2" / "ouro-dev.jsonl"
CAMPOS = ("id", "grupo", "fala", "contexto", "trecho", "alvo", "origem", "tipo", "arquivo", "pagina", "paragrafo")


def amostra(p: dict, fracao: float) -> bool:
    chave = f"{p['id']}|{p['arquivo']}|{p['pagina']}|{p['paragrafo']}"
    return int(hashlib.sha256(chave.encode()).hexdigest(), 16) % 1000 < fracao * 1000


def main() -> None:
    todos, _ = treinar.conjunto_dev()
    pares = aplicar(treinar.rotulos_revisados(todos), treinar.TREINO / "fontes-dev-semantica-v2.jsonl")
    pares = aplicar(pares, treinar.TREINO / "fontes-dev-semantica-v3.jsonl")
    escolhidos = [p for p in pares if p["origem"] in ("fonte-dev", "adjudicacao", "contexto-dev")
                  or (p["origem"] == "caso" and (p["alvo"] == 1 or amostra(p, .03)))
                  or (p["origem"] == "claude" and amostra(p, .12))]
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text("".join(json.dumps({k: p[k] for k in CAMPOS}, ensure_ascii=False) + "\n" for p in escolhidos), encoding="utf-8")
    from collections import Counter
    print(len(escolhidos), Counter((p["origem"], p["alvo"]) for p in escolhidos))


if __name__ == "__main__":
    main()
