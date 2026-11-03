"""Codificador da busca: bge-m3 denso em ONNX int8 na CPU, no processo da API, sem torch.

Os arquivos vêm de scripts/baixar_modelos.py, na revisão fixada aqui. PADRAO é a identidade gravada com cada vetor: mudar o
arquivo ou a revisão muda PADRAO, e os vetores gravados com outra identidade são recalculados, nunca misturados.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import numpy as np

from .esquema import RAIZ

REPO = "Xenova/bge-m3"
REVISAO = "4de13258303883538bd53b696b452bf8099f0858"
ONNX = "onnx/sentence_transformers_int8.onnx"
PADRAO = f"bge-m3-int8-onnx-{REVISAO[:12]}"
PASTA = Path(os.environ.get("COPILOTO_EMBEDDER_DIR", RAIZ / "modelos" / "bge-m3"))
# 0 lets ONNX Runtime size the pool to the physical cores.
THREADS = int(os.environ.get("COPILOTO_EMBEDDER_THREADS", 0))
MAX_TOKENS = 512
LOTE = 8

_TRAVA = threading.Lock()
_CARREGADO: list[tuple] = []


def arquivos() -> list[Path]:
    return [PASTA / "tokenizer.json", PASTA / ONNX]


def carregar() -> tuple:
    with _TRAVA:
        if not _CARREGADO:
            import onnxruntime as ort
            from tokenizers import Tokenizer

            tokenizer, onnx = arquivos()
            opcoes = ort.SessionOptions()
            opcoes.intra_op_num_threads = THREADS
            opcoes.inter_op_num_threads = 1
            # Session first: its ~250 MB load-time scratch would otherwise stack on the tokenizer's 250 MB at peak.
            sessao = ort.InferenceSession(str(onnx), opcoes, providers=["CPUExecutionProvider"])
            tok = Tokenizer.from_file(str(tokenizer))
            tok.no_padding()
            tok.enable_truncation(MAX_TOKENS)
            execucao = ort.RunOptions()
            # Without shrinkage the CPU arena keeps the largest batch's buffers for the life of the process.
            execucao.add_run_config_entry("memory.enable_memory_arena_shrinkage", "cpu:0")
            _CARREGADO.append((tok, sessao, execucao, tok.token_to_id("<pad>")))
        return _CARREGADO[0]


def codificar_documentos(textos: list[str]) -> np.ndarray:
    tok, sessao, execucao, pad = carregar()
    codificados = [e.ids for e in tok.encode_batch(textos)]
    ordem = sorted(range(len(textos)), key=lambda i: len(codificados[i]))
    partes = []
    for inicio in range(0, len(ordem), LOTE):
        lote = ordem[inicio:inicio + LOTE]
        ids = np.full((len(lote), len(codificados[lote[-1]])), pad, dtype=np.int64)
        mascara = np.zeros_like(ids)
        for linha, i in enumerate(lote):
            ids[linha, :len(codificados[i])] = codificados[i]
            mascara[linha, :len(codificados[i])] = 1
        partes.append(sessao.run(["sentence_embedding"], {"input_ids": ids, "attention_mask": mascara}, execucao)[0])
    vetores = np.concatenate(partes)[np.argsort(ordem)]
    return (vetores / np.linalg.norm(vetores, axis=1, keepdims=True)).astype(np.float32)


# bge-m3 takes queries as they are, with no instruction prefix.
codificar_consultas = codificar_documentos
