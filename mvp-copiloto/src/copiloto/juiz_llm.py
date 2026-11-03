"""Juiz, portão e reescritor por LLM: o Gemma 4 E4B base, com o adaptador desligado, atrás de um servidor compatível com a
API da OpenAI (vLLM ou llama-server).

O juiz é o professor da cascata: treino-juiz/professor.py rotula o treino do aluno com `pedido_juiz` daqui. Mudar uma
palavra do prompt muda o professor, e o limiar registrado da versão deixa de valer.
"""
from __future__ import annotations

import functools
import hashlib
import hmac
import math
import os
import secrets
from concurrent.futures import ThreadPoolExecutor

import httpx

URL = os.environ.get("COPILOTO_JUIZ_URL", "").rstrip("/")
MODELO_BASE = os.environ.get("COPILOTO_BASE_MODELO", "base")
CHAVE = os.environ.get("COPILOTO_JUIZ_CHAVE", "")
_PROCESS_CACHE_SALT_KEY = secrets.token_bytes(32)
VERSAO = os.environ.get("COPILOTO_JUIZ_VERSAO", "")
TIMEOUT_S = float(os.environ.get("COPILOTO_JUIZ_TIMEOUT", "20"))
CANDIDATOS = int(os.environ.get("COPILOTO_CANDIDATOS_JUIZ", "40"))
# O llama-server de tools/juiz/local.ps1 carrega um adaptador; a escala 0 o mantém desligado. O vLLM ignora o campo.
LORA_BASE = [{"id": 0, "scale": 0.0}]
PARALELO = 8

SISTEMA_JUIZ = ('You label training pairs for a clinical retrieval system. A pair is relevant only when the patient, speaking '
                'about themselves, expresses the clinical phenomenon the passage describes. Answer only "yes" or "no".')

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
risky or compulsive behavior, trauma, relationship or identity distress, substance use, or thoughts of death or self-harm;
or a clinically meaningful change in it: what helps them cope, support they rely on, progress or setbacks, what they hope
to change, or how they experience the therapy itself.
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


def cache_salt(account_id: str) -> str:
    key = CHAVE.encode() if CHAVE else _PROCESS_CACHE_SALT_KEY
    return hmac.new(key, f"limmiar:vllm-cache:v1:{account_id}".encode(), hashlib.sha256).hexdigest()


def no_ar() -> bool:
    try:
        return configurado() and httpx.get(f"{URL}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def pedido_juiz(trecho: str, frase: str) -> dict:
    # Passage before utterance, so the server reuses a passage's prefix across the utterances of a session.
    usuario = (f'Passage from a clinical article:\n"""{trecho}"""\n\nPatient utterance in a therapy session (Brazilian '
               f'Portuguese):\n"""{frase}"""\n\nDoes this passage describe the specific experience the patient expresses '
               '(the same symptom, belief, behavior, wish or change), and not only the general topic, such as the disorder '
               'in general, a study method, or the steps of a treatment? Answer yes or no.')
    # Thinking off in the request itself, so the prompt is the teacher's whatever reasoning default the server has.
    return {"messages": [{"role": "system", "content": SISTEMA_JUIZ}, {"role": "user", "content": usuario}],
            "chat_template_kwargs": {"enable_thinking": False}}


def _post(corpo: dict, *, cache_salt: str | None = None) -> dict:
    # Gemma 4 thinks by default: the gate's first token became "<|channel>" and the rewrite spent all its tokens reasoning.
    corpo = {"chat_template_kwargs": {"enable_thinking": False}, **corpo}
    if cache_salt is not None:
        corpo = {**corpo, "cache_salt": cache_salt}
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
    # A class cut from top_logprobs weighs at most the last listed token, so the answer is exact within that bound;
    # only a bound wider than 0.01 would be a made-up confidence.
    piso = min(math.exp(t["logprob"]) for t in top) if top else 0.0
    if sim == nao == 0 or (sim == 0 or nao == 0) and piso / (max(sim, nao) + piso) > 0.01:
        raise ValueError("O juiz não informou as duas classes nos logprobs disponíveis.")
    sim, nao = sim or piso, nao or piso
    return sim / (sim + nao)


def _sim_ou_nao(pedido: dict, *, cache_salt: str | None) -> float:
    resposta = _post({"model": MODELO_BASE, "lora": LORA_BASE, "max_tokens": 1, "temperature": 0, "logprobs": True,
                      "top_logprobs": 20, **pedido}, cache_salt=cache_salt)
    return prob_sim(resposta["choices"][0]["logprobs"]["content"][0]["top_logprobs"])


def julgar(fala: str, trechos: list[str], *, cache_salt: str | None = None) -> list[float]:
    if not trechos:
        return []
    with ThreadPoolExecutor(min(PARALELO, len(trechos))) as pool:
        return list(pool.map(lambda t: _sim_ou_nao(pedido_juiz(t, fala), cache_salt=cache_salt), trechos))


def mensagem_portao(fala: str, contexto: list[str]) -> str:
    anteriores = "\n".join(f"- {c}" for c in contexto) or "(none)"
    return f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{fala}\n\nyes or no"


def triar(fala: str, contexto: list[str], *, cache_salt: str | None = None) -> dict[str, float]:
    mensagens = {r: {"messages": [{"role": "system", "content": pergunta},
                                  {"role": "user", "content": mensagem_portao(fala, contexto)}]}
                 for r, pergunta in PERGUNTAS.items()}
    with ThreadPoolExecutor(len(PERGUNTAS)) as pool:
        notas = pool.map(lambda r: _sim_ou_nao(mensagens[r], cache_salt=cache_salt), PERGUNTAS)
        return dict(zip(PERGUNTAS, notas, strict=True))


def separar(texto: str) -> list[str]:
    if texto.strip().upper().startswith("NONE"):
        return []
    return [linha.split(":", 1)[1].strip() for linha in texto.splitlines() if linha[:3] in ("PT:", "EN:", "ES:") and ":" in linha]


@functools.lru_cache(maxsize=256)
def _reescrever(fala: str, contexto: tuple[str, ...], cache_salt: str | None = None) -> tuple[str, ...]:
    anteriores = "\n".join(f"- {c}" for c in contexto) or "(none)"
    resposta = _post({"model": MODELO_BASE, "lora": LORA_BASE, "max_tokens": 260, "temperature": 0,
                      "messages": [{"role": "system", "content": REESCRITA},
                                   {"role": "user", "content": f"PREVIOUS STATEMENTS:\n{anteriores}\n\nCURRENT STATEMENT:\n{fala}"}]},
                     cache_salt=cache_salt)
    return tuple(separar(resposta["choices"][0]["message"]["content"]))


def reescrever(fala: str, contexto: list[str], *, cache_salt: str | None = None) -> list[str]:
    """A fala em linguagem de artigo, em PT/EN/ES; lista vazia se o servidor disse que não há conteúdo clínico."""
    return list(_reescrever(fala, tuple(contexto), cache_salt))
