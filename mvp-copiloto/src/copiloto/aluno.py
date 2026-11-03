"""Aluno da cascata: o cross-encoder gte-multilingual-reranker-base com o LoRA destilado do professor (treino-juiz).

A produção não o usa mais (o juiz é `juiz_pequeno`). Ficam o carregador e os parâmetros de que dependem as
ferramentas do gabarito e do treino: gold/bakeoff_juiz.py, gold/cascata.py e treino-juiz/treinar.py.
"""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from .esquema import RAIZ

BASE = "Alibaba-NLP/gte-multilingual-reranker-base"
REVISAO_BASE = "8215cf04918ba6f7b6a62bb44238ce2953d8831c"
PASTA = RAIZ / "modelos" / "juiz-local" / "aluno-gte-v1"
MAX_TOKENS = 512
LOTE = 8

Notas = Callable[[str, list[str]], list[float]]


def reparar(modelo) -> None:
    """O código remoto do gte sob transformers 5: refaz buffers que ficaram no meta e repõe o helper de máscara removido."""
    import torch

    for mod in modelo.modules():
        if mod.__class__.__name__.endswith("Embeddings") and isinstance(getattr(mod, "position_ids", None), torch.Tensor):
            mod.position_ids = torch.arange(mod.position_ids.numel(), device=mod.position_ids.device)
        if hasattr(mod, "inv_freq") and hasattr(mod, "_set_cos_sin_cache"):
            mod.inv_freq = 1.0 / (mod.base ** (torch.arange(0, mod.dim, 2).float() / mod.dim))
            mod._set_cos_sin_cache(int(mod.max_position_embeddings * getattr(mod, "scaling_factor", 1)),
                                   mod.inv_freq.device, torch.float32)
        if mod.__class__.__name__ == "NewModel" and not hasattr(mod, "get_extended_attention_mask"):
            type(mod).get_extended_attention_mask = lambda self, mascara, _forma: (
                (1.0 - mascara[:, None, None, :].to(self.dtype)) * torch.finfo(self.dtype).min)


def carregar(pasta: Path = PASTA, dispositivo: str = "cpu") -> Notas:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(pasta)
    modelo = AutoModelForSequenceClassification.from_pretrained(BASE, revision=REVISAO_BASE, trust_remote_code=True,
                                                                dtype=torch.float32)
    reparar(modelo)
    modelo = PeftModel.from_pretrained(modelo, str(pasta)).merge_and_unload().to(dispositivo).eval()

    def notas(frase: str, textos: list[str]) -> list[float]:
        saida: list[float] = []
        with torch.inference_mode():
            for i in range(0, len(textos), LOTE):
                fatia = textos[i:i + LOTE]
                enc = tok([frase] * len(fatia), fatia, padding=True, truncation=True, max_length=MAX_TOKENS,
                          return_tensors="pt")
                saida += modelo(**enc.to(dispositivo)).logits[:, 0].float().sigmoid().tolist()
        return saida

    return notas
