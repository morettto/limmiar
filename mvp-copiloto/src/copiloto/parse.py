from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from pypdf import PdfReader

MIN_CARACTERES = 180
MAX_CARACTERES = 1200


@dataclass(frozen=True)
class Bloco:
    pagina: int
    paragrafo: int
    texto: str


def _limpar(bruto: str) -> str:
    sem_hifen = re.sub(r"-\n(?=\w)", "", bruto)
    unificado = re.sub(r"[ \t]+", " ", sem_hifen.replace("\r", ""))
    return unificado.strip()


def _partir_paragrafos(texto_pagina: str) -> list[str]:
    por_linha_branca = re.split(r"\n\s*\n", texto_pagina)
    if len(por_linha_branca) <= 1:
        por_linha_branca = re.split(r"\n(?=[A-ZÀ-Ý])", texto_pagina)
    return [p.replace("\n", " ").strip() for p in por_linha_branca if p.strip()]


def _juntar_curtos(paragrafos: list[str]) -> list[str]:
    saida: list[str] = []
    buffer = ""
    for p in paragrafos:
        candidato = f"{buffer} {p}".strip() if buffer else p
        if len(candidato) < MIN_CARACTERES:
            buffer = candidato
            continue
        saida.append(candidato[:MAX_CARACTERES])
        buffer = ""
    if buffer and len(buffer) >= 60:
        saida.append(buffer[:MAX_CARACTERES])
    return saida


_REFERENCIA = re.compile(
    r"\((?:19|20)\d\d[a-z]?\)|\b(?:19|20)\d\d[a-z]?\s*[;.]\s*\d+\s*\(|\bdoi\b|https?://|\bet al\.|\b\d+\s*\(\d+\)\s*[:,]|\bpp?\.\s*\d",
    re.IGNORECASE,
)
_METODO = re.compile(
    r"\bSPSS\b|\bSTATA\b|chi-?squ|qui-?quadrado|odds ratio|\bOR\s*=|\bIC\s*95|\b95\s*%\s*(?:CI|IC)|confidence interval|intervalo de confian|"
    r"\bp\s*[<=>≤]\s*0?[.,]\d|regress|cronbach|\bANOVA\b|\bt-test|teste t\b|desvio.padr|standard deviation|\bSD\s*=|\bDP\s*=|\bM\s*=\s*\d|"
    r"crit[ée]rios? de (?:inclus|exclus)|inclusion criteria|exclusion criteria|coleta de dados|recolecci[óo]n de datos|data (?:were )?(?:collected|analy[sz]ed)|"
    r"an[áa]lise estat[íi]stica|an[áa]lisis estad[íi]stico|statistical analys|amostra (?:foi|de|composta)|la muestra|the sample (?:was|consisted)|"
    r"participantes (?:foram|fueron)|participants (?:were|completed)|randomi[sz]ed|randomizad",
    re.IGNORECASE,
)


_AUTOR = re.compile(r"\b[A-ZÀ-Ý][a-zà-ÿ'-]+,\s(?:[A-Z]\.\s?){1,3}[,;&(]|\b[A-ZÀ-Ý]{2,}, [A-Z]\.|\b[A-Z][a-z]+ [A-Z]{1,3}[,.]\s")
_CABECALHO = re.compile(r"\bUniversity of|\bUniversidade|\bUniversidad|\bDepartment of|\bDepartamento de|\bCorrespondence|\bCorresponding author|\bReviewed by|"
                        r"\bRev\.? [A-Z][a-z]+|\b\d+\s*\(\d+\)\s*:\s*\d+|\bvol\.\s*\d|\bISSN|\be-?mail\b|\bAbbreviations\b|Conflict of interest",
                        re.IGNORECASE)


def motivo_descarte(texto: str) -> str | None:
    tokens = texto.split()
    if len(tokens) < 12:
        return "curto"
    numericos = sum(1 for t in tokens if re.fullmatch(r"[(\[]?[<>≤≥=±-]?\d+(?:[.,:;/–-]\d+)*%?[)\]]?[;,.]?", t))
    if numericos / len(tokens) > 0.18:
        return "tabela"
    referencias = len(_REFERENCIA.findall(texto)) + len(_AUTOR.findall(texto))
    if referencias >= max(3, len(tokens) // 30) or (len(tokens) < 80 and referencias >= 2):
        return "referencia"
    cabecalhos = len(_CABECALHO.findall(texto))
    if cabecalhos * 25 >= len(tokens) or (cabecalhos >= 2 and len(tokens) < 60):
        return "cabecalho"
    if len(_METODO.findall(texto)) >= 2:
        return "metodo"
    if texto.count("?") >= 3 and texto.count("?") * 25 > len(tokens) or re.search(r"(?:\b\d\s+){5,}", texto):
        return "questionario"
    letras = sum(c.isalpha() for c in texto)
    if letras / max(1, len(texto)) < 0.6:
        return "tabela"
    return None


def extrair(caminho: Path) -> tuple[list[Bloco], int]:
    leitor = PdfReader(str(caminho))
    blocos: list[Bloco] = []
    for indice, pagina in enumerate(leitor.pages, start=1):
        try:
            bruto = pagina.extract_text() or ""
        except Exception:
            continue
        texto = _limpar(bruto)
        if not texto:
            continue
        for numero, paragrafo in enumerate(_juntar_curtos(_partir_paragrafos(texto)), start=1):
            if motivo_descarte(paragrafo):
                continue
            blocos.append(Bloco(pagina=indice, paragrafo=numero, texto=paragrafo))
    return blocos, len(leitor.pages)


def texto_da_pagina(caminho: Path, pagina: int) -> str:
    versao = caminho.stat()
    return _texto_da_pagina(caminho, pagina, versao.st_mtime_ns, versao.st_size)


@lru_cache(maxsize=2048)
def _texto_da_pagina(caminho: Path, pagina: int, modificado_ns: int, tamanho: int) -> str:
    leitor = PdfReader(str(caminho))
    if pagina < 1 or pagina > len(leitor.pages):
        return ""
    return _limpar(leitor.pages[pagina - 1].extract_text() or "")
