from __future__ import annotations

import math
import os
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from . import jev

URL_JUIZ = os.environ.get("COPILOTO_JUIZ_URL", "http://127.0.0.1:8081")
TIMEOUT_S = float(os.environ.get("COPILOTO_JUIZ_TIMEOUT", "20"))
VERSAO_PROMPT = "juiz-v2"
MAX_CARACTERES_TRECHO = 900

SISTEMA = """Você é um psicólogo clínico sênior que revisa sugestões bibliográficas feitas durante uma sessão de psicoterapia.

Recebe a fala atual do PACIENTE, algumas falas anteriores como contexto, e trechos de livros e artigos. Para cada trecho decide se ele descreve o MESMO fenômeno clínico que o paciente está expressando: o mesmo sintoma, a mesma experiência vivida, o mesmo mecanismo ou o mesmo comportamento.

Regras:
- Responda "corresponde": true apenas se um psicólogo experiente, lendo o trecho, diria sem hesitar que ele explica o que este paciente está vivendo.
- Mesmo tema geral não basta. Um trecho sobre epidemiologia, métodos, estatística, instrumentos ou história da área não corresponde.
- Figuras de linguagem ("morri de vergonha"), termos banalizados ("sou meio TOC"), reações proporcionais a uma situação concreta e comentários sobre outra pessoa não são fenômenos clínicos do paciente.
- Na dúvida, "corresponde": false.
- "fenomeno_na_fala": o fenômeno clínico que o paciente expressa, em no máximo 8 palavras. Escreva uma vez só.
- Para cada trecho, "fenomeno_no_trecho": o fenômeno que o trecho descreve, em no máximo 8 palavras.
- "citacao_literal": se corresponde, de 6 a 30 palavras copiadas letra por letra do trecho, sem alterar nada, que sustentam a decisão. Se não corresponde, deixe vazia.
- Os trechos podem estar em português, espanhol ou inglês. A fala também. Julgue o sentido, não a língua."""

class _AvaliacaoJuiz(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: StrictStr
    fenomeno_no_trecho: StrictStr = Field(max_length=80)
    corresponde: StrictBool
    citacao_literal: StrictStr = Field(max_length=240)


class _RespostaJuiz(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fenomeno_na_fala: StrictStr = Field(max_length=90)
    avaliacoes: list[_AvaliacaoJuiz]


ESQUEMA = _RespostaJuiz.model_json_schema()


@dataclass(frozen=True)
class Avaliacao:
    trecho_id: str
    corresponde: bool
    probabilidade: float
    fenomeno_na_fala: str
    fenomeno_no_trecho: str
    citacao_literal: str
    citacao_confere: bool


def citacao_confere(citacao: str, texto: str) -> bool:
    return len(citacao.split()) >= 6 and citacao in texto


def _mensagem(fala: str, contexto: list[str], trechos: list[tuple[str, str]]) -> str:
    anteriores = "\n".join(f"- {c}" for c in contexto[-5:]) or "- (nenhuma)"
    blocos = "\n\n".join(f"[{tid}]\n{texto}" for tid, texto in trechos)
    return f"Falas anteriores do paciente:\n{anteriores}\n\nFala atual do paciente:\n\"{fala}\"\n\nTrechos:\n\n{blocos}\n\nAvalie cada trecho, na mesma ordem, usando o id entre colchetes."


def _probabilidades_booleanas(logprobs: list[dict]) -> list[float]:
    saida: list[float] = []
    for i, token in enumerate(logprobs):
        texto = token.get("token", "")
        if texto.strip() not in ("true", "false"):
            continue
        anterior = "".join(t.get("token", "") for t in logprobs[max(0, i - 6):i])
        if "corresponde" not in anterior:
            continue
        verdadeiro = sum(math.exp(alt["logprob"]) for alt in token.get("top_logprobs", []) if alt.get("token", "").strip() == "true")
        falso = sum(math.exp(alt["logprob"]) for alt in token.get("top_logprobs", []) if alt.get("token", "").strip() == "false")
        saida.append(verdadeiro / (verdadeiro + falso) if verdadeiro + falso > 0 else 0.0)
    return saida


def avaliar(fala: str, contexto: list[str], trechos: list[tuple[str, str]], cliente: httpx.Client | None = None) -> list[Avaliacao]:
    if not trechos:
        return []
    ids = [f"T{i + 1}" for i in range(len(trechos))]
    corpo = {
        "messages": [
            {"role": "system", "content": SISTEMA},
            {"role": "user", "content": _mensagem(fala, contexto, list(zip(ids, (t for _, t in trechos))))},
        ],
        "temperature": 0,
        "max_tokens": 60 + 130 * len(trechos),
        "logprobs": True,
        "top_logprobs": 5,
        "response_format": {"type": "json_schema", "json_schema": {"name": "avaliacoes", "schema": ESQUEMA}},
    }
    http = cliente or httpx.Client(timeout=TIMEOUT_S)
    try:
        resposta = http.post(f"{URL_JUIZ}/v1/chat/completions", json=corpo, timeout=TIMEOUT_S)
        resposta.raise_for_status()
        escolha = resposta.json()["choices"][0]
        dados = _RespostaJuiz.model_validate_json(escolha["message"]["content"])
        probs = _probabilidades_booleanas((escolha.get("logprobs") or {}).get("content") or [])
    except (httpx.HTTPError, KeyError, ValueError, TypeError, IndexError, AttributeError, OverflowError):
        return []
    finally:
        if cliente is None:
            http.close()
    brutos = dados.avaliacoes
    if len({a.id for a in brutos}) != len(brutos) or any(a.id not in ids for a in brutos):
        return []
    por_id = {a.id: (a, probs[i] if i < len(probs) else 0.0) for i, a in enumerate(brutos)}
    saida: list[Avaliacao] = []
    for tid, (trecho_id, texto) in zip(ids, trechos):
        bruto, prob = por_id.get(tid, (None, 0.0))
        if bruto is None:
            continue
        corresponde = bruto.corresponde
        citacao = bruto.citacao_literal
        saida.append(
            Avaliacao(
                trecho_id=trecho_id,
                corresponde=corresponde,
                probabilidade=prob,
                fenomeno_na_fala=dados.fenomeno_na_fala,
                fenomeno_no_trecho=bruto.fenomeno_no_trecho,
                citacao_literal=citacao,
                citacao_confere=citacao_confere(citacao, texto),
            )
        )
    return saida


FENOMENOS = {
    "ideacao_suicida_passiva": "desejo de estar morto ou de não acordar, sem plano",
    "ideacao_suicida_ativa": "pensamentos de se matar com plano, método ou intenção",
    "autolesao": "ferir-se de propósito para aliviar sofrimento, sem intenção de morrer",
    "panico": "ataque súbito de medo intenso com sintomas físicos",
    "preocupacao_generalizada": "preocupação constante e difusa com o futuro",
    "ruminacao": "pensar repetidamente em algo que já aconteceu",
    "anedonia": "perda de prazer ou interesse pelas coisas",
    "culpa_desvalia": "sentir-se culpado, inútil ou um peso para os outros",
    "memorias_intrusivas": "lembranças, imagens ou pesadelos de um trauma que voltam sem querer",
    "evitamento_traumatico": "evitar lugares, pessoas ou conversas ligadas a um trauma",
    "dissociacao": "sentir-se fora do corpo ou achar o mundo irreal",
    "luto": "sofrimento pela morte ou perda de alguém",
    "somatizacao": "queixas no corpo ligadas a sofrimento emocional, nervos",
    "insonia": "dificuldade persistente para dormir",
    "compulsao_purgacao": "comer compulsivamente e depois vomitar ou compensar",
    "uso_substancias": "uso problemático de álcool ou drogas",
    "obsessoes_compulsoes": "pensamentos intrusivos indesejados ou rituais repetitivos",
    "experiencias_psicoticas": "ouvir vozes ou crer em mensagens e perseguições",
    "hipomania": "energia excessiva, pouco sono, impulsividade",
    "burnout": "esgotamento ligado ao trabalho",
    "padrao_relacional": "medo de abandono, submissão ou conflitos repetidos nas relações",
    "violencia_parceiro": "sofrer agressão ou controlo do parceiro",
    "outro": "outro fenômeno clínico ou nenhum",
}

REGRAS_JEV = (
    "Julgue como um psicólogo clínico sênior. Responda sim apenas se o trecho descreve o MESMO fenômeno clínico "
    "que o paciente expressa na fala_do_paciente (mesmo sintoma, experiência vivida, mecanismo ou comportamento), "
    "de forma que um psicólogo diria sem hesitar que o trecho explica o que este paciente vive. Mesmo tema geral não basta. "
    "Trechos sobre métodos, estatística, epidemiologia, instrumentos, referências ou história da área não correspondem. "
    "Figuras de linguagem, termos banalizados, reações proporcionais e falas sobre outra pessoa não são fenômenos do paciente. "
    "Use as falas_anteriores para entender referências como \"aquilo\". Fala e trecho podem estar em línguas diferentes."
)


def _frases_citaveis(texto: str) -> tuple[str, ...]:
    frases = [f.strip() for f in re.split(r"(?<=[.!?;])\s+", texto) if len(f.split()) >= 6]
    limpas = [f for f in frases if not re.search(r"https?://|\bdoi\b|ISSN|\bv\.\s*\d|\bet al\.", f, re.IGNORECASE)]
    return tuple(limpas or frases)


_CITACOES: OrderedDict[str, tuple] = OrderedDict()
_TRAVA_CITACOES = threading.Lock()
MAX_PASSAGENS_CITACOES = 4096


def frases_mais_proximas(fala: str, textos: list[str], vetor_consulta=None) -> list[str]:
    import numpy as np
    from . import embedder

    if not textos:
        return []
    with _TRAVA_CITACOES:
        novos = [(texto, _frases_citaveis(texto)) for texto in dict.fromkeys(textos) if texto not in _CITACOES]
        frases_novas = [frase for _, frases in novos for frase in frases]
        vetores = embedder.codificar_documentos(frases_novas) if frases_novas else None
        inicio = 0
        for texto, frases in novos:
            _CITACOES[texto] = (frases, vetores[inicio:inicio + len(frases)].copy() if frases else None)
            inicio += len(frases)
        passagens = [_CITACOES[texto] for texto in textos]
        for texto in textos:
            _CITACOES.move_to_end(texto)
        while len(_CITACOES) > MAX_PASSAGENS_CITACOES:
            _CITACOES.popitem(last=False)
    if vetor_consulta is None and any(frases for frases, _ in passagens):
        vetor_consulta = embedder.codificar_consultas([fala])[0]
    return [frases[int(np.argmax(vetores @ vetor_consulta))] if frases else texto
            for texto, (frases, vetores) in zip(textos, passagens, strict=True)]


def frase_mais_proxima(fala: str, texto: str) -> str:
    return frases_mais_proximas(fala, [texto])[0]


def citacoes_qualificadas(fala: str, contexto: list[str], textos: list[str], probabilidades: list[float], limiar: float) -> list[tuple[str, float]]:
    from . import treinado

    opcoes = [tuple(dict.fromkeys((*_frases_citaveis(texto), texto))) for texto in textos]
    novas = list(dict.fromkeys(citacao for texto, frases in zip(textos, opcoes, strict=True)
                              for citacao in frases if citacao != texto))
    scores = treinado.julgar(fala, contexto, novas) if novas else []
    if len(scores) != len(novas):
        raise ValueError('O juiz não avaliou todas as citações literais.')
    por_citacao = dict(zip(novas, scores, strict=True))
    saida = []
    for texto, frases, original in zip(textos, opcoes, probabilidades, strict=True):
        aprovadas = [(citacao, original if citacao == texto else por_citacao[citacao]) for citacao in frases]
        aprovadas = [(citacao, score) for citacao, score in aprovadas
                     if math.isfinite(score) and limiar <= score <= 1 and citacao_confere(citacao, texto)]
        if not aprovadas:
            saida.append(('', 0.0))
        else:
            citacao, score = min(aprovadas, key=lambda item: (len(item[0].split()), -item[1]))
            saida.append((citacao, min(original, score)))
    return saida


def avaliar_tudo_jev(fala: str, contexto: list[str], trechos: list[tuple[str, str]],
                     cliente: httpx.Client | None = None) -> tuple[dict | None, list[Avaliacao]]:
    ids = [f"T{i + 1}" for i in range(len(trechos))]
    estado = {
        "fala_do_paciente": fala,
        "falas_anteriores": contexto[-5:],
        "trechos": {tid: texto[:MAX_CARACTERES_TRECHO] for tid, (_, texto) in zip(ids, trechos)},
    }
    perguntas = {**PERGUNTAS_TRIAGEM_JEV}
    perguntas.update({tid: jev.sim_ou_nao(f"O trecho {tid} descreve o mesmo fenômeno clínico que o paciente expressa? {REGRAS_JEV}") for tid in ids})
    perguntas["fenomeno_fala"] = jev.escolha("Qual fenômeno clínico o paciente expressa na fala_do_paciente?", FENOMENOS)
    try:
        respostas = jev.avaliar(estado, perguntas, cliente)
        triagem = {k: float(respostas[k]["probabilidade"]) for k in PERGUNTAS_TRIAGEM_JEV}
        if any(not math.isfinite(p) or not 0 <= p <= 1 for p in triagem.values()):
            return None, []
    except (httpx.HTTPError, KeyError, ValueError, TypeError, AttributeError):
        return None, []
    from .treinado import consulta

    return triagem, avaliacoes_de(respostas, consulta(fala, contexto), ids, trechos)


PERGUNTAS_TRIAGEM_JEV = {
    "clinica": jev.sim_ou_nao((
        "A fala_do_paciente expressa um fenômeno clínico do próprio paciente (sintoma, sofrimento, experiência emocional, "
        "comportamento, pensamento, relação ou risco)? Não conta: cumprimentos, logística, pagamento, agenda, conversa do dia a dia, "
        "figuras de linguagem como \"morri de vergonha\", termos banalizados como \"sou meio TOC\", reações proporcionais a uma "
        "situação concreta, e comentários sobre outras pessoas.")),
    "risco": jev.sim_ou_nao((
        "A fala_do_paciente sugere ideação suicida (passiva ou ativa), autolesão, ou violência de um parceiro contra o paciente?")),
    "ambigua": jev.sim_ou_nao((
        "A fala_do_paciente pode ser tanto cansaço ou vontade de fugir quanto ideação suicida passiva, de modo que só uma "
        "pergunta do terapeuta esclareceria? Exemplos: \"vontade de sumir\", \"não aguento mais\".")),
}


def avaliacoes_de(respostas: dict, fala: str, ids: list[str], trechos: list[tuple[str, str]]) -> list[Avaliacao]:
    fenomeno = respostas.get("fenomeno_fala", {}).get("escolha", "outro")
    saida: list[Avaliacao] = []
    for tid, (trecho_id, texto) in zip(ids, trechos):
        r = respostas.get(tid)
        if not r or "probabilidade" not in r:
            continue
        prob = r["probabilidade"]
        if not isinstance(prob, (float, int)) or not math.isfinite(prob) or not 0 <= prob <= 1:
            continue
        citacao = frase_mais_proxima(fala, texto[:MAX_CARACTERES_TRECHO]) if prob >= 0.5 else ""
        saida.append(Avaliacao(
            trecho_id=trecho_id, corresponde=prob >= 0.5, probabilidade=prob,
            fenomeno_na_fala=FENOMENOS.get(fenomeno, fenomeno), fenomeno_no_trecho="",
            citacao_literal=citacao, citacao_confere=bool(citacao) and citacao_confere(citacao, texto),
        ))
    return saida
