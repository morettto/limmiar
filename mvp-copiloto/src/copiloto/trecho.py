from __future__ import annotations

import re

PALAVRA = re.compile(r"[^\W\d_]{2,}")
ANO = re.compile(r"\b(?:19|20)\d{2}[a-z]?\b")
CHAVES = re.compile(r"^\s*(?:keywords?|palabras?\s+clave|palavras?[- ]chave|uniterm\w*|descritores|resumen|abstract|resumo)\b", re.I)
RODAPE = re.compile(r"\b(?:issn|doi:|doi\.org|https?://|vol\.|rev\.|©|e-?issn)\b", re.I)
UMA_LETRA = set("aeoyàéóôi")
INICIAIS = re.compile(r"\b[A-Z]\.\s?[A-Z]?\.?\s")


def prosa(texto: str) -> bool:
    """Falso para cabeçalho, rodapé, lista de referências, tabela ou OCR quebrado: trecho que não explica nada sozinho."""
    t = " ".join(texto.split())
    if len(t) < 80:
        return False
    tokens = t.split()
    if sum(c.isalpha() for c in t) / len(t) < 0.62:
        return False
    if sum(len(x) == 1 and x.isalpha() and x.lower() not in UMA_LETRA for x in tokens) / len(tokens) > 0.12:
        return False
    if len(PALAVRA.findall(t)) < 10:
        return False
    if len(ANO.findall(t)) >= 6 and len(INICIAIS.findall(t)) >= 4:
        return False
    return not (CHAVES.match(t) and len(t) < 500)
