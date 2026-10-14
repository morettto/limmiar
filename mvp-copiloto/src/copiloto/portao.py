from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from .juiz import TIMEOUT_S, URL_JUIZ

VERSAO_PROMPT = "portao-v2"

SISTEMA = """Você faz a triagem das falas de uma sessão de psicoterapia, uma de cada vez.

Classifique a fala atual do PACIENTE:
- "clinica": true se a fala expressa um fenômeno clínico do próprio paciente (sintoma, sofrimento, experiência emocional, comportamento, pensamento, relação, risco). false para cumprimentos, logística, pagamento, agenda, conversa do dia a dia, figuras de linguagem ("morri de vergonha"), termos banalizados ("sou meio TOC"), reações proporcionais a uma situação concreta, e comentários sobre outras pessoas.
- "canal": "risco" se a fala sugere ideação suicida (passiva ou ativa), autolesão ou violência por parceiro contra o paciente; "geral" para outros fenômenos clínicos; "nenhum" se não é clínica.
- "ambigua": true se a fala pode ser tanto cansaço ou vontade de fugir quanto ideação suicida passiva, e só uma pergunta do terapeuta esclareceria ("vontade de sumir", "não aguento mais").
- "termos": se a fala é clínica, de 3 a 8 termos técnicos, separados por vírgula, em português e em inglês, que um livro de psicologia ou psiquiatria usaria para o fenômeno (exemplo: "bulimia, vômito autoinduzido, compulsão alimentar, binge eating, purging"). Se não é clínica, deixe vazio.

Use as falas anteriores para entender referências como "aquilo" ou "desde aquele dia". A fala pode estar em português, espanhol ou inglês."""

class _RespostaTriagem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clinica: StrictBool
    canal: Literal["risco", "geral", "nenhum"]
    ambigua: StrictBool
    termos: StrictStr = Field(max_length=200)


ESQUEMA = _RespostaTriagem.model_json_schema()


@dataclass(frozen=True)
class Triagem:
    clinica: bool
    probabilidade: float
    canal: str
    ambigua: bool
    valida: bool
    termos: str = ""


def _prob_primeiro_booleano(logprobs: list[dict]) -> float | None:
    for token in logprobs:
        if token.get("token", "").strip() not in ("true", "false"):
            continue
        alternativas = token.get("top_logprobs", [])
        verdadeiro = sum(math.exp(a["logprob"]) for a in alternativas if a.get("token", "").strip() == "true")
        falso = sum(math.exp(a["logprob"]) for a in alternativas if a.get("token", "").strip() == "false")
        if verdadeiro + falso > 0:
            return verdadeiro / (verdadeiro + falso)
        return None
    return None


def triar(fala: str, contexto: list[str], cliente: httpx.Client | None = None) -> Triagem:
    anteriores = "\n".join(f"- {c}" for c in contexto[-5:]) or "- (nenhuma)"
    corpo = {
        "messages": [
            {"role": "system", "content": SISTEMA},
            {"role": "user", "content": f"Falas anteriores do paciente:\n{anteriores}\n\nFala atual do paciente:\n\"{fala}\""},
        ],
        "temperature": 0,
        "max_tokens": 110,
        "logprobs": True,
        "top_logprobs": 5,
        "response_format": {"type": "json_schema", "json_schema": {"name": "triagem", "schema": ESQUEMA}},
    }
    http = cliente or httpx.Client(timeout=TIMEOUT_S)
    try:
        resposta = http.post(f"{URL_JUIZ}/v1/chat/completions", json=corpo, timeout=TIMEOUT_S)
        resposta.raise_for_status()
        escolha = resposta.json()["choices"][0]
        dados = _RespostaTriagem.model_validate_json(escolha["message"]["content"])
        prob = _prob_primeiro_booleano((escolha.get("logprobs") or {}).get("content") or [])
        if prob is None or not math.isfinite(prob) or not 0 <= prob <= 1:
            raise ValueError("probabilidade ausente ou inválida")
    except (httpx.HTTPError, KeyError, ValueError, TypeError, IndexError, AttributeError, OverflowError):
        return Triagem(clinica=False, probabilidade=0.0, canal="nenhum", ambigua=False, valida=False)
    finally:
        if cliente is None:
            http.close()
    return Triagem(
        clinica=dados.clinica,
        probabilidade=prob,
        canal=dados.canal,
        ambigua=dados.ambigua,
        valida=True,
        termos=dados.termos,
    )

