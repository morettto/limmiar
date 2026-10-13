from __future__ import annotations

import os
import time

import httpx

DIRETO = bool(os.environ.get("TYPESAFE_API_KEY"))
URL = os.environ.get("COPILOTO_JEV_URL", "https://api.typesafe.ai/v1/systemone" if DIRETO else "https://ai-gateway.vercel.sh/v4/ai/evaluation-model")
MODELO = os.environ.get("COPILOTO_JEV_MODELO", "jev-latest" if DIRETO else "typesafe-ai/jev")
TIMEOUT_S = float(os.environ.get("COPILOTO_JEV_TIMEOUT", "10"))
RETENCAO_ZERO = os.environ.get("COPILOTO_JEV_RETENCAO_ZERO", "1") != "0"
TENTATIVAS = int(os.environ.get("COPILOTO_JEV_TENTATIVAS", "0"))


def chave() -> str:
    return os.environ.get("TYPESAFE_API_KEY") or os.environ.get("AI_GATEWAY_API_KEY", "")


def disponivel() -> bool:
    return bool(chave())


def _cabecalhos() -> dict[str, str]:
    if DIRETO:
        return {"Authorization": f"Bearer {chave()}", "Content-Type": "application/json"}
    return {
        "Authorization": f"Bearer {chave()}",
        "Content-Type": "application/json",
        "Ai-Gateway-Protocol-Version": "0.0.1",
        "Ai-Gateway-Auth-Method": "api-key",
        "Ai-Evaluation-Model-Specification-Version": "4",
        "Ai-Model-Id": MODELO,
    }


def sim_ou_nao(instrucoes: str) -> dict:
    return {"type": "noul" if DIRETO else "boolean", "instructions": instrucoes}


def escolha(instrucoes: str, opcoes: dict[str, str]) -> dict:
    return {"type": "choice", "instructions": instrucoes, "criteria": opcoes}


def avaliar(estado: object, perguntas: dict[str, dict], cliente: httpx.Client | None = None) -> dict[str, dict]:
    corpo = {"state": estado, "questions": perguntas}
    if DIRETO:
        corpo["model"] = MODELO
    elif RETENCAO_ZERO:
        corpo["providerOptions"] = {"gateway": {"zeroDataRetention": True}}
    http = cliente or httpx.Client(timeout=TIMEOUT_S)
    try:
        for tentativa in range(TENTATIVAS + 1):
            try:
                resposta = http.post(URL, json=corpo, headers=_cabecalhos(), timeout=TIMEOUT_S)
                estado_http = resposta.status_code
            except httpx.TransportError as erro:
                if tentativa == TENTATIVAS:
                    raise
                estado_http = type(erro).__name__
            transitorio = isinstance(estado_http, str) or estado_http in (429, 529) or estado_http >= 500
            if not transitorio or tentativa == TENTATIVAS:
                break
            espera = min(120, 10 * 2 ** tentativa)
            if os.environ.get("COPILOTO_JEV_LOG"):
                print(f"    jev {estado_http}, a esperar {espera}s", flush=True)
            time.sleep(espera)
        resposta.raise_for_status()
        dados = resposta.json()
    finally:
        if cliente is None:
            http.close()
    respostas = dados["answers"]
    confianca = ((dados.get("providerMetadata") or {}).get("typesafe") or {}).get("confidence") or {}
    saida: dict[str, dict] = {}
    for nome, r in respostas.items():
        if r.get("type") == "noul":
            saida[nome] = {"probabilidade": float(r["noul"])}
        elif r.get("type") == "boolean":
            saida[nome] = {"probabilidade": float(r["probability"])}
        elif r.get("type") == "choice":
            saida[nome] = {"escolha": r["choice"], "probabilidades": r.get("probabilities") or {}, "confianca": r.get("confidence", confianca.get(nome))}
        else:
            saida[nome] = dict(r)
    return saida
