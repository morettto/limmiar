"""Juiz do copiloto: um cross-encoder mmBERT-small destilado, um logit por par, em ONNX na CPU, no processo da API.

O par diz a pergunta: (fala, trecho) dá `principal`; (pergunta, trecho) dá `generico`; (fala, pergunta) dá `vivencia` e
`risco`. As perguntas e a versão estão em data/juiz-pequeno.json; mudar uma palavra delas muda o juiz, e os cortes
registrados da versão deixam de valer.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import numpy as np

from .esquema import RAIZ

PASTA = Path(os.environ.get("COPILOTO_JUIZ_DIR", RAIZ / "modelos" / "juiz-pequeno"))
ONNX = os.environ.get("COPILOTO_JUIZ_ONNX", "model_gather.onnx")
THREADS = int(os.environ.get("COPILOTO_JUIZ_THREADS", max(1, (os.cpu_count() or 2) // 2)))
MAX_TOKENS = 320
LOTE = 8
_DADOS = json.loads((RAIZ / "data" / "juiz-pequeno.json").read_text(encoding="utf-8"))
VERSAO: str = _DADOS["versao"]
PERGUNTAS: dict[str, str] = _DADOS["perguntas"]

_TRAVA = threading.Lock()
_CARREGADO: list[tuple] = []


def arquivos() -> list[Path]:
    return [PASTA / "tokenizer.json", PASTA / "onnx" / ONNX]


def _carregar() -> tuple:
    import onnxruntime as ort
    from tokenizers import Tokenizer

    tokenizer, onnx = arquivos()
    tok = Tokenizer.from_file(str(tokenizer))
    pad = (tok.padding or {}).get("pad_id", 0)
    tok.no_padding()
    tok.no_truncation()
    opcoes = ort.SessionOptions()
    opcoes.intra_op_num_threads = THREADS
    opcoes.inter_op_num_threads = 1
    sessao = ort.InferenceSession(str(onnx), opcoes, providers=["CPUExecutionProvider"])
    execucao = ort.RunOptions()
    # Without shrinkage the CPU arena keeps the largest batch's buffers for the life of the process.
    execucao.add_run_config_entry("memory.enable_memory_arena_shrinkage", "cpu:0")
    return tok, sessao, execucao, pad


def _codificar(tok, pares: list[tuple[str, str]]) -> list[list[int]]:
    especiais = tok.num_special_tokens_to_add(True)
    primeiras = tok.encode_batch([a for a, _ in pares], add_special_tokens=False)
    segundas = tok.encode_batch([b for _, b in pares], add_special_tokens=False)
    saida = []
    for a, b in zip(primeiras, segundas, strict=True):
        # only_second, as in training. The app's turns reach 2000 characters, which only_second cannot fit:
        # the first text keeps at most half the window.
        a.truncate(MAX_TOKENS // 2)
        b.truncate(MAX_TOKENS - especiais - len(a.ids))
        saida.append(tok.post_process(a, b).ids)
    return saida


def _notas(pares: list[tuple[str, str]]) -> list[float]:
    if not pares:
        return []
    with _TRAVA:
        if not _CARREGADO:
            _CARREGADO.append(_carregar())
    tok, sessao, execucao, pad = _CARREGADO[0]
    codificados = _codificar(tok, pares)
    ordem = sorted(range(len(pares)), key=lambda i: len(codificados[i]))
    notas = np.empty(len(pares))
    for inicio in range(0, len(ordem), LOTE):
        lote = ordem[inicio:inicio + LOTE]
        ids = np.full((len(lote), len(codificados[lote[-1]])), pad, dtype=np.int64)
        mascara = np.zeros_like(ids)
        for linha, i in enumerate(lote):
            ids[linha, :len(codificados[i])] = codificados[i]
            mascara[linha, :len(codificados[i])] = 1
        logits = sessao.run(["logits"], {"input_ids": ids, "attention_mask": mascara}, execucao)[0]
        notas[lote] = 1 / (1 + np.exp(-logits[:, 0].astype(np.float64)))
    return notas.tolist()


def principal(fala: str, trechos: list[str]) -> list[float]:
    return _notas([(fala, trecho) for trecho in trechos])


def generico(textos: list[str]) -> list[float]:
    return _notas([(PERGUNTAS["generico"], texto) for texto in textos])


def vivencia(fala: str) -> float:
    return _notas([(fala, PERGUNTAS["vivencia"])])[0]


def risco(fala: str) -> float:
    return _notas([(fala, PERGUNTAS["risco"])])[0]
