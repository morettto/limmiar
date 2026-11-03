"""Rotulagem cega dos cartões da carga ponta a ponta, com controles do gold escondidos no meio.

montar: lê .local/simulacao-laya/e2e-ui/cartoes.jsonl (analisar_carga_ui.py), junta 5 pares nota 2 e 5 nota 0 do gold de
dev, embaralha e grava lote.md (só fala e parágrafo, sem nota do Laya) e chave.json. As notas vão em respostas.txt, uma
linha "N: nota" por item, na régua estrita (2 = a mesma experiência específica; 1 = mesmo tema; 0 = outra experiência).
conferir: cruza respostas.txt com a chave; diz o acerto dos controles e a precisão dos cartões (nota 2), com IC95 de Wilson.
Uso: rotular_cartoes_carga.py montar | conferir
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PASTA = RAIZ / ".local/simulacao-laya/e2e-ui"
FALAS = RAIZ / ".local/claude-goal/falas-hipoteticas"


def wilson(acertos: int, n: int) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    z, p = 1.96, acertos / n
    meio = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    centro = p + z * z / (2 * n)
    return (centro - meio) / (1 + z * z / n), (centro + meio) / (1 + z * z / n)


def controles() -> list[dict]:
    sys.path.insert(0, str(FALAS))
    from avaliar import carregar_gold

    notas = carregar_gold("dev")[2]
    pares = {json.loads(l)["par"]: json.loads(l) for l in open(FALAS / "kaggle/dataset/pares-piloto.jsonl", encoding="utf-8")}
    rotulados = [(p, n) for p, n in notas.items() if p in pares]
    random.seed(7)
    escolhidos = random.sample([p for p, n in rotulados if n == 2], 5) + random.sample([p for p, n in rotulados if n == 0], 5)
    return [{"tipo": "controle", "esperada": notas[p], "fala": pares[p]["frase"], "trecho": pares[p]["trecho"]} for p in escolhidos]


def montar() -> None:
    cartoes = [dict(json.loads(l), tipo="cartao") for l in open(PASTA / "cartoes.jsonl", encoding="utf-8")]
    vistos, itens = set(), []
    for c in cartoes + controles():
        chave = (c["fala"], c["trecho"])
        if chave not in vistos:
            vistos.add(chave)
            itens.append(c)
    random.seed(11)
    random.shuffle(itens)
    with open(PASTA / "lote.md", "w", encoding="utf-8") as arq:
        for i, item in enumerate(itens, 1):
            arq.write(f"## {i}\n\nFala: {item['fala']}\n\nParágrafo: {item['trecho']}\n\n")
    (PASTA / "chave.json").write_text(json.dumps(itens, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(itens)} itens ({sum(i['tipo'] == 'cartao' for i in itens)} cartões, 10 controles) em lote.md")


def conferir() -> None:
    itens = json.loads((PASTA / "chave.json").read_text(encoding="utf-8"))
    notas = {}
    for linha in (PASTA / "respostas.txt").read_text(encoding="utf-8").splitlines():
        if ":" in linha:
            numero, nota = linha.split(":", 1)
            notas[int(numero)] = int(nota.strip())
    ctrl = [(notas[i], item["esperada"]) for i, item in enumerate(itens, 1) if item["tipo"] == "controle"]
    cartoes = [(notas[i], item) for i, item in enumerate(itens, 1) if item["tipo"] == "cartao"]
    certos = sum(n == 2 for n, _ in cartoes)
    baixo, alto = wilson(certos, len(cartoes))
    resultado = {"controles_certos": sum((n == 2) == (e == 2) for n, e in ctrl), "controles": len(ctrl),
                 "cartoes": len(cartoes), "nota2": certos, "nota1": sum(n == 1 for n, _ in cartoes),
                 "nota0": sum(n == 0 for n, _ in cartoes), "precisao": round(certos / len(cartoes), 3) if cartoes else None,
                 "ic95": [round(baixo, 3), round(alto, 3)],
                 "erros": [{"fala": i["fala"], "titulo": i["titulo"], "nota": n, "laya": i["probabilidade"]} for n, i in cartoes if n != 2]}
    (PASTA / "rotulagem.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resultado, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    {"montar": montar, "conferir": conferir}[sys.argv[1]]()
