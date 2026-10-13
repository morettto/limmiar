from __future__ import annotations

import os
import threading

import numpy as np

_MODELOS: dict[str, object] = {}
_TRAVA = threading.Lock()

PADRAO = "BAAI/bge-m3"

INSTRUCAO_CLINICA = (
    "Instruct: Given a patient's statement in a therapy session, retrieve passages from "
    "clinical psychology literature that describe the same symptom, experience or treatment\nQuery: "
)

PREFIXO_CONSULTA = {
    "intfloat/multilingual-e5-small": "query: ",
    "intfloat/multilingual-e5-base": "query: ",
    "Qwen/Qwen3-Embedding-0.6B": INSTRUCAO_CLINICA,
}
PREFIXO_DOCUMENTO = {
    "intfloat/multilingual-e5-small": "passage: ",
    "intfloat/multilingual-e5-base": "passage: ",
}


def carregar(nome: str = PADRAO):
    with _TRAVA:
        if nome not in _MODELOS:
            from sentence_transformers import SentenceTransformer

            _MODELOS[nome] = SentenceTransformer(nome, device=os.environ.get("COPILOTO_EMBEDDER_DISPOSITIVO", "cpu"))
        return _MODELOS[nome]


def dimensao(nome: str = PADRAO) -> int:
    return int(carregar(nome).get_sentence_embedding_dimension())


def _codificar(textos: list[str], nome: str, prefixo: str, lote: int) -> np.ndarray:
    modelo = carregar(nome)
    entrada = [prefixo + t for t in textos] if prefixo else textos
    vetores = modelo.encode(
        entrada,
        batch_size=lote,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return np.asarray(vetores, dtype=np.float32)


def codificar_documentos(textos: list[str], nome: str = PADRAO, lote: int = 32) -> np.ndarray:
    return _codificar(textos, nome, PREFIXO_DOCUMENTO.get(nome, ""), lote)


def codificar_consultas(textos: list[str], nome: str = PADRAO, lote: int = 32) -> np.ndarray:
    return _codificar(textos, nome, PREFIXO_CONSULTA.get(nome, ""), lote)
