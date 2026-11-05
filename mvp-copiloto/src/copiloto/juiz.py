from __future__ import annotations

import re

MAX_PALAVRAS_CITACAO = 30
_REFERENCIA_NO_INICIO = re.compile(r"^\s*\(?\s*(?:19|20)\d{2}\)?[.,;:]", re.IGNORECASE)


def citacao_confere(citacao: str, texto: str) -> bool:
    return len(citacao.split()) >= 6 and citacao in texto


def _frases_citaveis(texto: str) -> tuple[str, ...]:
    if _REFERENCIA_NO_INICIO.match(texto):
        return ()
    frases = [f.strip() for f in re.split(r"(?<=[.!?;])\s+", texto)
              if 6 <= len(f.split()) <= MAX_PALAVRAS_CITACAO]
    limpas = [f for f in frases if not re.search(r"https?://|\bdoi\b|ISSN|\bv\.\s*\d|\bet al\.", f, re.IGNORECASE)]
    return tuple(limpas or frases)


def opcoes_de_citacao(texto: str) -> tuple[str, ...]:
    """As frases do trecho que podem ir no cartão como citação literal; o próprio trecho entra se for curto."""
    curto = len(texto.split()) <= MAX_PALAVRAS_CITACAO and not _REFERENCIA_NO_INICIO.match(texto)
    opcoes = (*_frases_citaveis(texto), texto) if curto else _frases_citaveis(texto)
    return tuple(c for c in dict.fromkeys(opcoes) if citacao_confere(c, texto))
