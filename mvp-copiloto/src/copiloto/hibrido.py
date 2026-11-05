from __future__ import annotations

import re

import numpy as np

K_RRF = 60


def tokenizar(texto: str) -> list[str]:
    return re.findall(r"\w+", texto.lower(), flags=re.UNICODE)


class IndiceLexical:
    def __init__(self, textos: list[str]) -> None:
        from rank_bm25 import BM25Okapi

        self.bm25 = BM25Okapi([tokenizar(t) for t in textos])

    def reordenar(self, consulta: str, candidatos: list[int]) -> list[int]:
        scores = self.bm25.get_batch_scores(tokenizar(consulta), candidatos)
        return [candidatos[int(p)] for p in np.argsort(-np.asarray(scores), kind="stable")]

    def ordenar(self, consulta: str, k: int) -> list[int]:
        scores = self.bm25.get_scores(tokenizar(consulta))
        k = min(k, len(scores))
        melhores = np.argpartition(-scores, k - 1)[:k]
        return [int(p) for p in melhores[np.argsort(-scores[melhores])]]


def fundir_rrf(*ordens: list[int], k: int, constante: int = K_RRF) -> list[int]:
    pontos: dict[int, float] = {}
    for ordem in ordens:
        for posicao, indice in enumerate(ordem):
            pontos[indice] = pontos.get(indice, 0.0) + 1.0 / (constante + posicao + 1)
    return [i for i, _ in sorted(pontos.items(), key=lambda par: -par[1])[:k]]
