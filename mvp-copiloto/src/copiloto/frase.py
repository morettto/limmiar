"""Entrada do juiz centrada no sentido da frase atual."""
from __future__ import annotations

INSTRUCAO = (
    "Judge whether a literal part of the passage directly explains at least ONE experience, symptom, behavior or mechanism explicitly expressed by the patient's CURRENT sentence. "
    "A sentence can express several phenomena. One supported phenomenon is enough; the passage need not explain every detail of the sentence. "
    "Judge the meaning of that sentence. Previous sentences only clarify references such as 'that'; they cannot add symptoms or experiences absent from the current sentence. "
    "Respect negation, reported speech, who experiences the event, and its context. A broad topic or shared disorder name is insufficient. "
    "Do not assign a diagnosis, an unexpressed symptom, or the source's entire case to the patient. A general mechanism or symptom description can apply across different cases when its literal description matches the current sentence. "
    "Reject a different phenomenon, substance, cause-specific mechanism or experiential context. Shared words alone do not establish a match. "
    "Statistics, bibliography and research procedures alone do not explain an experience; an actual description inside such a section can. "
    "Return no if the relationship requires unsupported assumptions."
)


def consulta(fala: str, contexto: list[str]) -> str:
    anteriores = '\n'.join(contexto[-5:]) or '(none)'
    return f'CURRENT patient sentence:\n{fala}\n\nPrevious sentences, only to resolve references:\n{anteriores}'


def formato_qwen(fala: str, contexto: list[str], trecho: str) -> str:
    return formato_consulta(consulta(fala, contexto), trecho)


def formato_consulta(consulta_: str, trecho: str) -> str:
    from .treinado import PREFIXO_QWEN, SUFIXO_QWEN
    return f'{PREFIXO_QWEN}<Instruct>: {INSTRUCAO}\n<Query>: {consulta_}\n<Document>: {trecho}{SUFIXO_QWEN}'
