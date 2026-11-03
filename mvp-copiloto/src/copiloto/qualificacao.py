"""Registro das versões do juiz (data/juiz-v2/registro.jsonl): os cortes da decisão e se a versão foi promovida.

Uma versão medida no gabarito serve cartões com o seu limiar; a promoção é a decisão do ciclo.py com as notas do
profissional, e a saúde da API a informa.
"""
from __future__ import annotations

import json
import math

from .esquema import RAIZ


def _linha(juiz: str) -> dict | None:
    arquivo = RAIZ / "data" / "juiz-v2" / "registro.jsonl"
    try:
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            if linha.strip() and (registro := json.loads(linha))["versao"] == juiz:
                return registro
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


CORTES = ("vivencia", "generico", "principal")


def limiares(juiz: str) -> dict | None:
    """Os cortes que a decisão lê (vivencia, generico, principal) registrados para a versão; None se faltar algum ou se
    não for um número finito, como a margem das cascatas antigas."""
    try:
        valores = {chave: _linha(juiz)["limiares"][chave] for chave in CORTES}
    except (TypeError, KeyError):
        return None
    finitos = all(type(v) in (int, float) and math.isfinite(v) for v in valores.values())
    return valores if finitos else None


def qualificado(juiz: str) -> bool:
    return bool(juiz) and limiares(juiz) is not None


def promovida(juiz: str) -> bool:
    return qualificado(juiz) and _linha(juiz).get("promovida") is True
