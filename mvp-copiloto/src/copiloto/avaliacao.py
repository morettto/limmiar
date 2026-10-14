from __future__ import annotations

import random
import re
import hashlib
import json
import numpy as np

MIN_PALAVRAS_QUERY = 8


def hash_caso(caso: dict) -> str:
    contexto = {"fala": caso["fala"], "contexto": caso.get("contexto", []),
                "falante": caso.get("falante", "paciente"), "idioma": caso["idioma"]}
    return hashlib.sha256(json.dumps(contexto, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def avaliar_referencias(casos: list[dict], registos: list[dict], revisoes: list[dict]) -> dict:
    por_id = {c["id"]: c for c in casos}
    adjudicados = {}
    for revisao in revisoes:
        if type(revisao["valido"]) is not bool or not revisao.get("justificativa", "").strip():
            raise ValueError("Revisão exige booleano estrito e justificativa contextual")
        chave = (revisao["caso_sha256"], revisao["trecho_id"], revisao["trecho_sha256"])
        if chave in adjudicados and adjudicados[chave] != revisao["valido"]:
            raise ValueError("Revisões conflitantes da mesma fala e passagem")
        adjudicados[chave] = revisao["valido"]
    validos = invalidos = cobertos = falas_emitidas = negativos_emitidos = 0
    pendentes = []
    esperadas = encontradas = 0
    for registo in registos:
        caso = por_id[registo["id"]]
        alvos = set(caso.get("esperados", []))
        esperadas += len(alvos)
        cartoes = registo["decisao"]["cartoes"]
        if len({c["trecho_id"] for c in cartoes}) != len(cartoes):
            raise ValueError("Resposta duplica a mesma passagem")
        falas_emitidas += bool(cartoes)
        negativos_emitidos += bool(cartoes) and not bool(alvos)
        encontradas += len(alvos & {c["trecho_id"] for c in cartoes})
        fala_coberta = False
        for cartao in cartoes:
            chave = (hash_caso(caso), cartao["trecho_id"], hashlib.sha256(cartao["texto"].encode()).hexdigest())
            valido = adjudicados.get(chave)
            if valido is None and cartao["trecho_id"] in alvos:
                valido = True
            if valido is None and not alvos:
                valido = False
            if valido is True:
                validos += 1
                fala_coberta = True
            elif valido is False:
                invalidos += 1
            else:
                pendentes.append({"id": caso["id"], "caso_sha256": chave[0], "fala": caso["fala"],
                                  "contexto": caso.get("contexto", []), "trecho_sha256": chave[2],
                                  "cartao": cartao})
        cobertos += bool(alvos) and fala_coberta
    total = validos + invalidos + len(pendentes)
    positivos = sum(bool(c.get("esperados")) for c in casos)
    return {"references_emitted": total, "utterances_emitted": falas_emitidas,
            "references_valid": validos, "references_invalid": invalidos,
            "references_pending": len(pendentes),
            "semantic_precision": validos / total if total and not pendentes else None,
            "precision_bounds_pending": [validos / total, (validos + len(pendentes)) / total] if total else None,
            "coverage_positive_verified": cobertos / positivos if positivos else None,
            "recall_known_anchors": encontradas / esperadas if esperadas else None,
            "negative_utterances_with_references": negativos_emitidos, "pending_review": pendentes}


def frases(texto: str) -> list[str]:
    partes = re.split(r"(?<=[.!?])\s+", texto)
    return [p.strip() for p in partes if len(p.split()) >= MIN_PALAVRAS_QUERY]


def gerar_consultas(trechos: list[dict], seed: int = 42, por_trecho: int = 1) -> list[dict]:
    aleatorio = random.Random(seed)
    consultas: list[dict] = []
    for trecho in trechos:
        candidatas = frases(trecho["texto"])
        if not candidatas:
            continue
        aleatorio.shuffle(candidatas)
        for frase in candidatas[:por_trecho]:
            consultas.append(
                {
                    "consulta": frase,
                    "trecho_id": trecho["id"],
                    "obra_id": trecho["obra_id"],
                    "idioma": trecho["idioma"],
                }
            )
    return consultas


def metricas(posicoes: list[int | None], k_recall: tuple[int, ...] = (1, 5)) -> dict:
    total = len(posicoes)
    if total == 0:
        return {"consultas": 0}
    saida: dict[str, float | int] = {"consultas": total}
    for k in k_recall:
        acertos = sum(1 for p in posicoes if p is not None and p < k)
        saida[f"recall_em_{k}"] = round(acertos / total, 4)
    reciprocos = [1.0 / (p + 1) for p in posicoes if p is not None and p < 10]
    saida["mrr_em_10"] = round(sum(reciprocos) / total, 4)
    return saida


def posicao_do_alvo(ordenados: list[str], alvo: str) -> int | None:
    try:
        return ordenados.index(alvo)
    except ValueError:
        return None


def percentil(valores: list[float], p: float) -> float:
    if not valores:
        return 0.0
    return round(float(np.percentile(np.array(valores), p)), 2)
