"""Transforma as avaliações do profissional (formulário das 5 mil falas) em dados de treino e de teste.
Uso: rotulos_5k.py ROTULAGEM-5K.json ROTULOS-5K.json SAIDA_DIR [NOTAS.json]

Metade das obras do acervo de teste vai para treino e metade para um teste novo; o profissional vence o gerador.
Imprime a taxa de acerto por estrato: a de `fonte_exata` diz se as falas geradas valem como rótulo positivo.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

SIM_NAO = {"sim": 1, "nao": 0}


def lado(obra: str) -> str:
    """A obra inteira fica de um lado só, escolhido pelo nome (as mesmas regras do teste fixo: nome truncado, sem .pdf)."""
    nome = obra.lower().removesuffix(".pdf")[:50]
    return "teste" if int(hashlib.sha256(nome.encode()).hexdigest(), 16) % 2 == 0 else "treino"


def linhas(cartoes: list[dict], respostas: dict[str, str]) -> list[dict]:
    return [{"id": c["k"].split("|")[0], "fala": c["fala"], "contexto": [], "trecho": c["trecho"], "arquivo": c["obra"], "alvo": SIM_NAO[respostas[c["k"]]],
             "origem": "rotulo_usuario", "estrato": c["estrato"], "prob": c["prob"]} for c in cartoes if respostas.get(c["k"]) in SIM_NAO]


def linhas_suaves(cartoes: list[dict], notas: dict[str, float]) -> list[dict]:
    """Treino pela nota do profissional (0 a 1), inclusive as dúvidas; `alvo` binário é nota >= 0,9."""
    return [{"id": c["k"].split("|")[0], "fala": c["fala"], "contexto": [], "trecho": c["trecho"], "arquivo": c["obra"], "alvo": int(notas[c["k"]] >= 0.9),
             "alvo_suave": notas[c["k"]], "origem": "rotulo_usuario", "estrato": c["estrato"], "prob": c["prob"]} for c in cartoes if c["k"] in notas]


def taxas(cartoes: list[dict], respostas: dict[str, str]) -> dict:
    saida = {}
    for estrato in sorted({c["estrato"] for c in cartoes}):
        votos = Counter(respostas.get(c["k"], "sem resposta") for c in cartoes if c["estrato"] == estrato)
        decididos = votos["sim"] + votos["nao"]
        saida[estrato] = {**votos, "acerto": round(votos["sim"] / decididos, 3) if decididos else None}
    return saida


def main() -> None:
    cartoes = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["cards"]
    respostas = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    pasta = Path(sys.argv[3])
    pasta.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 4:
        notas = json.loads(Path(sys.argv[4]).read_text(encoding="utf-8"))
        for nome in ("treino", "teste"):
            parte = [r for r in linhas_suaves(cartoes, notas) if lado(r["arquivo"]) == nome]
            (pasta / f"rotulos-5k-suave-{nome}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in parte), encoding="utf-8")
            print(nome, "suave", len(parte), "linhas;", sum(r["alvo"] for r in parte), "com nota >= 0,9")
    rows = linhas(cartoes, respostas)
    for nome in ("treino", "teste"):
        parte = [r for r in rows if lado(r["arquivo"]) == nome]
        (pasta / f"rotulos-5k-{nome}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in parte), encoding="utf-8")
        print(nome, len(parte), "linhas;", sum(r["alvo"] for r in parte), "positivas")
    print(json.dumps(taxas(cartoes, respostas), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
