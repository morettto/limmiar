from __future__ import annotations

import threading

from .esquema import RAIZ, Idioma

PARA_INGLES = "Helsinki-NLP/opus-mt-ROMANCE-en"
DO_INGLES = "Helsinki-NLP/opus-mt-en-ROMANCE"
ALVO = {"pt-BR": ">>pt_br<<", "es": ">>es<<"}
IDIOMAS: tuple[Idioma, ...] = ("pt-BR", "es", "en-US")
DIR_MODELOS = RAIZ / "modelos"

_TRAVA = threading.Lock()
_MODELOS: dict[str, tuple[object, object]] = {}


def _carregar(nome: str):
    with _TRAVA:
        if nome not in _MODELOS:
            import ctranslate2
            from transformers import AutoTokenizer

            destino = DIR_MODELOS / nome.split("/")[-1]
            if not (destino / "model.bin").exists():
                ctranslate2.converters.TransformersConverter(nome).convert(
                    str(destino), quantization="int8", force=True
                )
            _MODELOS[nome] = (
                AutoTokenizer.from_pretrained(nome),
                ctranslate2.Translator(str(destino), device="cpu", compute_type="int8", intra_threads=4),
            )
        return _MODELOS[nome]


def _gerar(nome: str, textos: list[str]) -> list[str]:
    tokenizador, tradutor = _carregar(nome)
    entrada = [tokenizador.convert_ids_to_tokens(tokenizador.encode(t, truncation=True, max_length=128)) for t in textos]
    saida = tradutor.translate_batch(entrada, beam_size=1, max_decoding_length=96)
    return [
        tokenizador.decode(tokenizador.convert_tokens_to_ids(r.hypotheses[0]), skip_special_tokens=True)
        for r in saida
    ]


def aquecer() -> None:
    _carregar(PARA_INGLES)
    _carregar(DO_INGLES)


def variantes(frase: str, idioma: Idioma) -> dict[Idioma, str]:
    saida: dict[Idioma, str] = {idioma: frase}
    ingles = frase if idioma == "en-US" else _gerar(PARA_INGLES, [frase])[0]
    saida["en-US"] = ingles
    faltam = [i for i in ("pt-BR", "es") if i not in saida]
    if faltam:
        for alvo, texto in zip(faltam, _gerar(DO_INGLES, [f"{ALVO[i]} {ingles}" for i in faltam])):
            saida[alvo] = texto
    return saida
