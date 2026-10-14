from __future__ import annotations

import os
import threading

from . import juiz_llm
from .esquema import RAIZ

MODELOS = RAIZ / "modelos" / "juiz-local"
NOME_JUIZ = os.environ.get("COPILOTO_JUIZ_LOCAL", "gte-r2")
ROTULOS_TRIAGEM = ("clinica", "risco", "ambigua")

_CARREGADOS: dict[str, tuple] = {}
_TRAVA = threading.Lock()


def pasta(nome: str):
    return MODELOS / nome / "torch"


def disponivel() -> bool:
    return juiz_llm.configurado() or (pasta(NOME_JUIZ) / "config.json").exists() and arquivo_triagem().exists()


def formato(nome: str) -> str | None:
    if juiz_llm.configurado():
        return None
    arquivo = pasta(nome) / "formato.txt"
    if not arquivo.exists():
        return None
    valor = arquivo.read_text(encoding="utf-8").strip()
    if valor not in ("qwen", "qwen-frase-v2"):
        raise ValueError("Formulação do juiz desconhecida; não inferir com outra entrada.")
    return valor


def arquivo_triagem():
    if formato(NOME_JUIZ) == "qwen-frase-v2":
        return MODELOS / "triagem-frase-rbf" / "rbf.npz"
    return MODELOS / "triagem" / "logistica.npz"


def consulta(fala: str, contexto: list[str]) -> str:
    anteriores = " / ".join(contexto)
    return f"{anteriores} || {fala}" if anteriores else fala


def consulta_para_modelo(fala: str, contexto: list[str], nome: str | None = None) -> str:
    if formato(nome or NOME_JUIZ) == "qwen-frase-v2":
        from .frase import consulta as consulta_frase

        return consulta_frase(fala, contexto)
    return consulta(fala, contexto)


PREFIXO_QWEN = ("<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. "
                "Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n")
SUFIXO_QWEN = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
INSTRUCAO_QWEN = "Given a patient's utterance in a therapy session, judge whether the passage describes the same clinical phenomenon the patient expresses"


def formato_qwen(consulta_: str, trecho: str) -> str:
    return f"{PREFIXO_QWEN}<Instruct>: {INSTRUCAO_QWEN}\n<Query>: {consulta_}\n<Document>: {trecho}{SUFIXO_QWEN}"


def reparar(modelo) -> None:
    import torch

    for mod in modelo.modules():
        if mod.__class__.__name__.endswith("Embeddings") and isinstance(getattr(mod, "position_ids", None), torch.Tensor):
            mod.position_ids = torch.arange(mod.position_ids.numel(), device=mod.position_ids.device)
        if hasattr(mod, "inv_freq") and hasattr(mod, "_set_cos_sin_cache"):
            mod.inv_freq = 1.0 / (mod.base ** (torch.arange(0, mod.dim, 2).float() / mod.dim))
            mod._set_cos_sin_cache(int(mod.max_position_embeddings * getattr(mod, "scaling_factor", 1)), mod.inv_freq.device, torch.float32)


def _carregar(nome: str):
    with _TRAVA:
        if nome not in _CARREGADOS:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            dispositivo = "cuda" if torch.cuda.is_available() and os.environ.get("COPILOTO_JUIZ_DISPOSITIVO", "cuda") == "cuda" else "cpu"
            tok = AutoTokenizer.from_pretrained(pasta(nome), trust_remote_code=True)
            modelo = AutoModelForSequenceClassification.from_pretrained(pasta(nome), trust_remote_code=True,
                                                                        dtype=getattr(torch, os.environ.get("COPILOTO_JUIZ_DTYPE", "float32")))
            reparar(modelo)
            _CARREGADOS[nome] = (tok, modelo.to(dispositivo).eval())
        return _CARREGADOS[nome]


def aquecer() -> None:
    triar("olá", [])
    julgar("olá", [], ["texto de aquecimento"])


def _sigmoide(nome: str, a: list[str], b: list[str] | None):
    import torch

    tok, modelo = _carregar(nome)
    formulacao = formato(nome)
    if formulacao is not None and b is not None:
        if formulacao == "qwen-frase-v2":
            from .frase import formato_consulta
            formatar = formato_consulta
        else:
            formatar = formato_qwen
        enc = tok([formatar(x, y) for x, y in zip(a, b, strict=True)], truncation=False)
    else:
        enc = tok(a, b, truncation=False)
    comprimento = max(map(len, enc["input_ids"]))
    if comprimento > modelo.config.max_position_embeddings:
        raise ValueError("A fala e o contexto excedem a capacidade do juiz; revise os turnos antes de consultar.")
    lote = 4 if comprimento <= 512 else 1
    saida = []
    with torch.inference_mode():
        for i in range(0, len(a), lote):
            fatia = tok.pad({k: v[i:i + lote] for k, v in enc.items()}, padding=True,
                            return_tensors="pt").to(modelo.device)
            saida.extend(torch.sigmoid(modelo(**fatia).logits.float()).cpu().tolist())
    return saida


def _triagem():
    with _TRAVA:
        if "triagem" not in _CARREGADOS:
            import numpy as np

            with np.load(arquivo_triagem()) as pesos:
                _CARREGADOS["triagem"] = {k: pesos[k] for k in pesos.files}
        return _CARREGADOS["triagem"]


def triar(fala: str, contexto: list[str]) -> dict[str, float]:
    if juiz_llm.configurado():
        return juiz_llm.triar(fala, contexto)
    import numpy as np

    from . import embedder

    pesos = _triagem()
    modelo = str(pesos["modelo"])
    if formato(NOME_JUIZ) != "qwen-frase-v2":
        x = embedder.codificar_consultas([consulta(fala, contexto)], modelo)[0]
        return {r: float(v) for r, v in zip(ROTULOS_TRIAGEM, 1 / (1 + np.exp(-(x @ pesos["W"] + pesos["b"]))))}
    from . import triagem_frase

    x = triagem_frase.codificar([fala], [contexto], modelo)[0].astype(np.float64)
    gamma = float(pesos["gamma"])
    notas = {}
    # 0,5 corresponde ao corte calibrado fora da partição em treinar_triagem_rbf.py.
    for r in ROTULOS_TRIAGEM:
        sv = pesos[f"{r}_sv"].astype(np.float64)
        score = np.exp(-gamma * ((sv - x) ** 2).sum(1)) @ pesos[f"{r}_dual"] + float(pesos[f"{r}_b"])
        notas[r] = float(1 / (1 + np.exp(-(score - float(pesos[f"{r}_corte"])))))
    return notas

def julgar(fala: str, contexto: list[str], trechos: list[str]) -> list[float]:
    if not trechos:
        return []
    if juiz_llm.configurado():
        return juiz_llm.julgar(fala, contexto, trechos)
    q = consulta_para_modelo(fala, contexto)
    return [linha[0] for linha in _sigmoide(NOME_JUIZ, [q] * len(trechos), trechos)]
