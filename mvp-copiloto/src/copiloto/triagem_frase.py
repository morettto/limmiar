"""Mantém a representação da frase atual separada do apoio de referência."""
from __future__ import annotations

import numpy as np

from . import embedder, frase


def codificar(falas: list[str], contextos: list[list[str]], modelo: str) -> np.ndarray:
    if len(falas) != len(contextos):
        raise ValueError('Cada frase deve ter seu próprio apoio de referência.')
    textos = falas + [frase.consulta(fala, contexto) for fala, contexto in zip(falas, contextos, strict=True)]
    vetores = embedder.codificar_consultas(textos, modelo)
    return np.concatenate((vetores[:len(falas)], vetores[len(falas):]), axis=1)
