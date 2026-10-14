"""Juiz e reescritor por LLM (Gemma 4 E4B + LoRA) atrás de um servidor compatível com a API da OpenAI (vLLM ou llama-server).

O prompt é o mesmo do treino: mudar qualquer palavra aqui exige retreinar o adaptador.
"""
from __future__ import annotations

import functools
import math
import os
from concurrent.futures import ThreadPoolExecutor

import httpx

URL = os.environ.get("COPILOTO_JUIZ_URL", "").rstrip("/")
MODELO = os.environ.get("COPILOTO_JUIZ_MODELO", "juiz")
MODELO_REESCRITA = os.environ.get("COPILOTO_REESCRITA_MODELO", "base")
MODELO_BASE = os.environ.get("COPILOTO_BASE_MODELO", "base")
CHAVE = os.environ.get("COPILOTO_JUIZ_CHAVE", "")
VERSAO = os.environ.get("COPILOTO_JUIZ_VERSAO", "")
TIMEOUT_S = float(os.environ.get("COPILOTO_JUIZ_TIMEOUT", "20"))
CANDIDATOS = int(os.environ.get("COPILOTO_CANDIDATOS_JUIZ", "40"))
MAX_TRECHO = 1600
# O vLLM escolhe o adaptador pelo nome do modelo e ignora "lora"; o llama-server ignora o nome e liga o adaptador 0 por pedido.
LORA_JUIZ = [{"id": 0, "scale": 1.0}]
LORA_BASE = [{"id": 0, "scale": 0.0}]
PARALELO = 8

RUBRICA = """You are a clinical psychology reference checker. A therapist selected study materials.
Decide whether the PASSAGE explicitly describes the same clinical phenomenon that the PATIENT expresses in the CURRENT STATEMENT.

Rules:
- Judge the current statement. Previous statements only resolve references and ellipses ("that", "since then"); they never add symptoms.
- The phenomenon must be what the patient says about themself now. If the statement negates it, quotes someone else, or describes a third person, answer no.
- "Same phenomenon" means the passage describes, defines, explains or reports that experience (e.g. avoidance after trauma, anticipatory catastrophic worry, loneliness from living alone). Language may differ.
- Answer no for mere topical proximity: same disorder or population but a different experience, statistics or methods without describing the experience, treatment of another problem, or figures of speech taken literally.
Answer with a single word: yes or no."""

REESCRITA = """You help a psychologist find passages in academic papers and books that explain what a patient says.
Read the patient's current statement (previous statements only resolve references) and describe the clinical
phenomenon it expresses, the way a scientific article would name and define it. Do not copy the patient's words.
If the statement has no clinical content, answer exactly: NONE.
Reply with exactly three lines:
PT: <1-2 sentences in Brazilian Portuguese, academic register>
EN: <same in English, with the technical terms used in the literature>
ES: <same in Spanish>"""

_ENTRADA_PORTAO = """You screen statements said by a patient in a psychotherapy session. Previous statements only give context.
Judge only the CURRENT STATEMENT. {pergunta}
Answer with a single word: yes or no."""

# Uma pergunta sim/não por rótulo; o portão lê a probabilidade de "yes" de cada uma.
PERGUNTAS = {rotulo: _ENTRADA_PORTAO.format(pergunta=texto) for rotulo, texto in {
    "clinica": """Answer yes only if the patient expresses, about themself, a clinically relevant experience: a symptom, suffering,
risky or compulsive behavior, trauma, relationship or identity distress, substance use, or thoughts of death or self-harm.
Answer no for small talk, logistics, neutral facts, mild everyday feelings, jokes or figures of speech (e.g. "I'm dying of laughter",
"I missed you to death"), statements only about other people, or anything said by the therapist.""",
    "risco": """Answer yes if the patient mentions suicide, thoughts of not wanting to be alive, self-harm (cutting, hurting oneself, guilt or shame
after hurting oneself), taking an excessive amount of pills or medication at once, or violence against themself or others, literally or as a wish.
Previous statements count: a statement that follows a mention of self-harm is about it.
Answer no for figures of speech ("dying of shame"), neutral talk, and statements said by the therapist.""",
    "ambigua": """Answer yes only if the statement could be a figure of speech OR a real wish to die or to disappear
(e.g. "sometimes I feel like vanishing"), and only a clarifying question to the patient would settle which.
Answer no if it is clearly figurative, clearly literal, or has nothing to do with death, self-harm or violence.""",
}.items()}

SIM, NAO = {"yes", "sim", "sí", "si"}, {"no", "não", "nao"}


def configurado() -> bool:
    return bool(URL)


def no_ar() -> bool:
    try:
        return configurado() and httpx.get(f"{URL}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def mensagem(fala: str, contexto: list[str], trecho: str) -> str:
    anteriores = "\n".join(f"- {c}" for c in contexto) or "(none)"
    return (f"PREVIOUS PATIENT STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{fala}\n\n"
            f"PASSAGE:\n{trecho[:MAX_TRECHO]}\n\nDoes the passage describe the same clinical phenomenon? yes or no")


def _post(corpo: dict) -> dict:
    cabecalhos = {"Authorization": f"Bearer {CHAVE}"} if CHAVE else {}
    resposta = httpx.post(f"{URL}/v1/chat/completions", json=corpo, headers=cabecalhos, timeout=TIMEOUT_S)
    resposta.raise_for_status()
    return resposta.json()


def prob_sim(top: list[dict]) -> float:
    sim = nao = 0.0
    for t in top:
        token = t["token"].strip().lower()
        if token in SIM:
            sim += math.exp(t["logprob"])
        elif token in NAO:
            nao += math.exp(t["logprob"])
    if sim + nao == 0:
        raise ValueError("O juiz não respondeu sim nem não.")
    return sim / (sim + nao)


def _julgar_um(fala: str, contexto: list[str], trecho: str) -> float:
    resposta = _post({"model": MODELO, "lora": LORA_JUIZ, "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 20,
                      "messages": [{"role": "system", "content": RUBRICA}, {"role": "user", "content": mensagem(fala, contexto, trecho)}]})
    return prob_sim(resposta["choices"][0]["logprobs"]["content"][0]["top_logprobs"])


def julgar(fala: str, contexto: list[str], trechos: list[str]) -> list[float]:
    if not trechos:
        return []
    with ThreadPoolExecutor(min(PARALELO, len(trechos))) as pool:
        return list(pool.map(lambda t: _julgar_um(fala, contexto, t), trechos))


def mensagem_portao(fala: str, contexto: list[str]) -> str:
    anteriores = "\n".join(f"- {c}" for c in contexto) or "(none)"
    return f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{fala}\n\nyes or no"


def _perguntar(rotulo: str, fala: str, contexto: list[str]) -> float:
    resposta = _post({"model": MODELO_BASE, "lora": LORA_BASE, "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 20,
                      "messages": [{"role": "system", "content": PERGUNTAS[rotulo]},
                                   {"role": "user", "content": mensagem_portao(fala, contexto)}]})
    return prob_sim(resposta["choices"][0]["logprobs"]["content"][0]["top_logprobs"])


def triar(fala: str, contexto: list[str]) -> dict[str, float]:
    with ThreadPoolExecutor(len(PERGUNTAS)) as pool:
        notas = pool.map(lambda r: _perguntar(r, fala, contexto), PERGUNTAS)
        return dict(zip(PERGUNTAS, notas, strict=True))


def separar(texto: str) -> list[str]:
    if texto.strip().upper().startswith("NONE"):
        return []
    return [linha.split(":", 1)[1].strip() for linha in texto.splitlines() if linha[:3] in ("PT:", "EN:", "ES:") and ":" in linha]


@functools.lru_cache(maxsize=256)
def _reescrever(fala: str, contexto: tuple[str, ...]) -> tuple[str, ...]:
    anteriores = "\n".join(f"- {c}" for c in contexto) or "(none)"
    resposta = _post({"model": MODELO_REESCRITA, "lora": LORA_BASE, "max_tokens": 260, "temperature": 0,
                      "messages": [{"role": "system", "content": REESCRITA},
                                   {"role": "user", "content": f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{fala}"}]})
    return tuple(separar(resposta["choices"][0]["message"]["content"]))


def reescrever(fala: str, contexto: list[str]) -> list[str]:
    """A fala em linguagem de artigo, em PT/EN/ES; lista vazia se o servidor disse que não há conteúdo clínico."""
    return list(_reescrever(fala, tuple(contexto)))
