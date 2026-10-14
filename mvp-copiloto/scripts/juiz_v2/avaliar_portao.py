"""Avalia a saída de portao_llm.py. Uso: avaliar_portao.py SAIDA.jsonl."""
from __future__ import annotations

import json
import sys
from pathlib import Path

LIMIARES = (0.1, 0.3, 0.5, 0.7, 0.9)
NEGATIVOS = ("neutro", "quase", "terapeuta", "ambiguo")


def taxa(valores: list[float], limiar: float) -> float | None:
    return sum(v >= limiar for v in valores) / len(valores) if valores else None


def avaliar(casos: list[dict], limiares: tuple[float, ...] = LIMIARES) -> list[dict]:
    """Por limiar: alarme falso (clinica ou risco acima do limiar) por tipo negativo; recall nos positivos."""
    positivos = [c for c in casos if c["tipo"] == "positivo"]
    saida = []
    for limiar in limiares:
        linha = {"limiar": limiar}
        for tipo in NEGATIVOS:
            grupo = [max(c["clinica"], c["risco"]) for c in casos if c["tipo"] == tipo]
            linha[f"alarme_{tipo}"] = taxa(grupo, limiar)
        linha["recall_clinica"] = taxa([c["clinica"] for c in positivos if c["canal"] == "geral"], limiar)
        linha["recall_risco"] = taxa([max(c["risco"], c["ambigua"]) for c in positivos if c["canal"] == "risco"], limiar)
        saida.append(linha)
    return saida


def formatar(linhas: list[dict]) -> str:
    chaves = list(linhas[0])
    celula = lambda v: "-" if v is None else f"{v:.3f}"
    return "\n".join(["\t".join(chaves), *("\t".join(celula(l[k]) for k in chaves) for l in linhas)])


if __name__ == "__main__":
    dados = [json.loads(l) for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if l.strip()]
    print(formatar(avaliar(dados)))
