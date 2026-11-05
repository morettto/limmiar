"""Alerta de risco: cabeça linear sobre o vetor bge-m3 da fala, sem modelo a mais. Pesos e corte em data/risco-cabeca.json,
treinados e medidos por .local/copiloto-fluxo/risco/medir_risco.py (corte pela validação cruzada, recall 0,98 no treino)."""
from __future__ import annotations

import json

import numpy as np

from . import embedder
from .esquema import RAIZ

_CABECA = json.loads((RAIZ / "data" / "risco-cabeca.json").read_text(encoding="utf-8"))
_PESOS = np.asarray(_CABECA["pesos"], dtype=np.float32)
if _CABECA["embedder"] != embedder.PADRAO:
    raise RuntimeError(f"cabeça de risco treinada sobre {_CABECA['embedder']}, não sobre {embedder.PADRAO}")


def nota(fala: str) -> float:
    # ponytail: a busca codifica a mesma fala de novo; dividir o vetor entre risco e busca quando a latência pedir.
    vetor = embedder.codificar_consultas([fala])[0]
    return float(vetor @ _PESOS + _CABECA["vies"])


def alerta(fala: str) -> bool:
    return nota(fala) >= _CABECA["corte"]
