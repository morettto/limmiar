from __future__ import annotations

import random
import re

MIN_PALAVRAS_QUERY = 8


def frases(texto: str) -> list[str]:
    partes = re.split(r"(?<=[.!?])\s+", texto)
    return [p.strip() for p in partes if len(p.split()) >= MIN_PALAVRAS_QUERY]


def gerar_consultas(trechos: list[dict], seed: int = 42, por_trecho: int = 1) -> list[dict]:
    aleatorio = random.Random(seed)
    consultas: list[dict] = []
    for trecho in trechos:
        candidatas = frases(trecho["texto"])
        if not candidatas:
            continue
        aleatorio.shuffle(candidatas)
        for frase in candidatas[:por_trecho]:
            consultas.append(
                {
                    "consulta": frase,
                    "trecho_id": trecho["id"],
                    "obra_id": trecho["obra_id"],
                    "idioma": trecho["idioma"],
                }
            )
    return consultas


def metricas(posicoes: list[int | None], k_recall: tuple[int, ...] = (1, 5)) -> dict:
    total = len(posicoes)
    if total == 0:
        return {"consultas": 0}
    saida: dict[str, float | int] = {"consultas": total}
    for k in k_recall:
        acertos = sum(1 for p in posicoes if p is not None and p < k)
        saida[f"recall_em_{k}"] = round(acertos / total, 4)
    reciprocos = [1.0 / (p + 1) for p in posicoes if p is not None and p < 10]
    saida["mrr_em_10"] = round(sum(reciprocos) / total, 4)
    return saida


def posicao_do_alvo(ordenados: list[str], alvo: str) -> int | None:
    try:
        return ordenados.index(alvo)
    except ValueError:
        return None


