from __future__ import annotations

import sqlite3
import threading
import time

import numpy as np
from pypdf.errors import PdfReadError

from . import embedder, hibrido, parse, traducao, trecho
from .esquema import Citacao, DIR_PDFS


class Indice:
    def __init__(self) -> None:
        self._trava = threading.Lock()
        self.ids: list[str] = []
        self.obras: np.ndarray = np.empty(0, dtype=object)
        self.matriz: np.ndarray = np.zeros((0, 0), dtype=np.float32)
        self.modelo: str = embedder.PADRAO
        self.lexical: hibrido.IndiceLexical | None = None
        self.carregado_em: float = 0.0

    def recarregar(self, con: sqlite3.Connection) -> None:
        usado = con.execute(
            "select modelo from obra where status = 'pronto' and modelo is not null limit 1"
        ).fetchone()
        if usado:
            self.modelo = usado["modelo"]
        linhas = con.execute(
            "select t.id, t.obra_id, t.texto, t.embedding from trecho t"
            " join obra o on o.id = t.obra_id"
            " where o.status = 'pronto' and t.embedding is not null"
        ).fetchall()
        linhas = [linha for linha in linhas if trecho.prosa(linha["texto"])]
        with self._trava:
            if not linhas:
                self.ids, self.matriz = [], np.zeros((0, 0), dtype=np.float32)
                self.obras = np.empty(0, dtype=object)
                self.lexical = None
            else:
                self.ids = [linha["id"] for linha in linhas]
                self.obras = np.array([linha["obra_id"] for linha in linhas], dtype=object)
                self.matriz = np.vstack(
                    [np.frombuffer(linha["embedding"], dtype=np.float32) for linha in linhas]
                )
                self.lexical = hibrido.IndiceLexical([linha["texto"] for linha in linhas])
            self.carregado_em = time.time()

    def vazio(self) -> bool:
        return self.matriz.size == 0

    def buscar(
        self,
        vetor: np.ndarray,
        limite: int,
        obras_ids: list[str] | None,
        frases: list[str] | None = None,
        candidatos: int | None = None,
    ) -> list[tuple[str, float]]:
        with self._trava:
            if self.matriz.size == 0:
                return []
            matriz, ids, obras, lexical = self.matriz, self.ids, self.obras, self.lexical
        permitidos = np.arange(len(ids))
        if obras_ids is not None:
            permitidos = np.flatnonzero(np.isin(obras, np.array(obras_ids, dtype=object)))
            if permitidos.size == 0:
                return []
        candidatos = min(candidatos or CANDIDATOS, permitidos.size)
        scores = matriz[permitidos] @ vetor
        topo = np.argpartition(-scores, candidatos - 1)[:candidatos]
        denso = [int(permitidos[p]) for p in topo[np.argsort(-scores[topo])]]
        listas = [denso]
        if frases and lexical is not None:
            listas += [lexical.reordenar(frase, denso) for frase in frases]
        ordem = hibrido.fundir_rrf(*listas, k=limite)
        similaridade = matriz[ordem] @ vetor
        return [(ids[i], float(x)) for i, x in zip(ordem, similaridade)]


CANDIDATOS = 10
INDICE = Indice()


def _proveniencia_ok(arquivo: str, pagina: int, texto: str) -> bool:
    caminho = DIR_PDFS / arquivo
    if not texto.strip() or not caminho.exists():
        return False
    try:
        da_pagina = parse.texto_da_pagina(caminho, pagina)
    except (OSError, ValueError, PdfReadError):
        return False
    return " ".join(texto.split()) in " ".join(da_pagina.split())


def consultar(
    con: sqlite3.Connection,
    frase: str,
    limite: int = 3,
    obras_ids: list[str] | None = None,
    limiar: float = 0.0,
    verificar_proveniencia: bool = True,
    idioma: str | None = "pt-BR",
    candidatos: int | None = None,
) -> tuple[list[Citacao], float, dict]:
    inicio = time.perf_counter()
    textos = {idioma or "original": frase}
    if idioma in traducao.IDIOMAS:
        textos = traducao.variantes(frase, idioma)
    traduzido_em = time.perf_counter()
    vetor = embedder.codificar_consultas([frase], INDICE.modelo)[0]
    brutos = INDICE.buscar(vetor, limite, obras_ids, list(dict.fromkeys(textos.values())), candidatos)
    buscado_em = time.perf_counter()
    citacoes: list[Citacao] = []
    for trecho_id, score in brutos:
        if score < limiar:
            continue
        linha = con.execute(
            "select t.id, t.obra_id, t.pagina, t.paragrafo, t.texto, t.idioma,"
            " o.titulo, o.autor, o.arquivo"
            " from trecho t join obra o on o.id = t.obra_id where t.id = ?",
            (trecho_id,),
        ).fetchone()
        if linha is None:
            continue
        if verificar_proveniencia and not _proveniencia_ok(
            linha["arquivo"], linha["pagina"], linha["texto"]
        ):
            continue
        citacoes.append(
            Citacao(
                trecho_id=linha["id"],
                obra_id=linha["obra_id"],
                arquivo=linha["arquivo"],
                titulo=linha["titulo"],
                autor=linha["autor"],
                idioma=linha["idioma"],
                pagina=linha["pagina"],
                paragrafo=linha["paragrafo"],
                texto=linha["texto"],
                score=round(score, 4),
                proveniencia="verificada" if verificar_proveniencia else "nao_verificada",
            )
        )
    fim = time.perf_counter()
    detalhe = {
        "variantes": textos,
        "traducao_ms": round((traduzido_em - inicio) * 1000, 1),
        "busca_ms": round((buscado_em - traduzido_em) * 1000, 1),
        "proveniencia_ms": round((fim - buscado_em) * 1000, 1),
    }
    return citacoes, (fim - inicio) * 1000, detalhe


def candidatos_amplos(
    con: sqlite3.Connection,
    frase: str,
    idioma: str,
    limite: int | None = None,
    obras_ids: list[str] | None = None,
    por_obra: int | None = None,
    profundidade: int | None = None,
    extras: list[str] | None = None,
    indice: Indice | None = None,
) -> list[Citacao]:
    textos = list(dict.fromkeys(traducao.variantes(frase, idioma).values())) if idioma in traducao.IDIOMAS else [frase]
    textos += [e for e in (extras or []) if e.strip()]
    fonte = indice if indice is not None else INDICE
    with fonte._trava:
        if fonte.matriz.size == 0:
            return []
        matriz, ids, obras, lexical = fonte.matriz, fonte.ids, fonte.obras, fonte.lexical
    permitidos = np.arange(len(ids))
    if obras_ids is not None:
        permitidos = np.flatnonzero(np.isin(obras, np.array(obras_ids, dtype=object)))
        if permitidos.size == 0:
            return []
    aceites = set(permitidos.tolist())
    n = min(profundidade or permitidos.size, permitidos.size)
    listas: list[list[int]] = []
    for vetor in embedder.codificar_consultas(textos, fonte.modelo):
        scores = matriz[permitidos] @ vetor
        topo = np.argpartition(-scores, n - 1)[:n]
        listas.append([int(permitidos[p]) for p in topo[np.argsort(-scores[topo])]])
    if lexical is not None:
        for texto in textos:
            listas.append([i for i in lexical.ordenar(texto, len(ids)) if i in aceites][:n])
    escolhidos: list[int] = []
    por_obra_contagem: dict[str, int] = {}
    for i in hibrido.fundir_rrf(*listas, k=n * len(listas)):
        obra = obras[i]
        if por_obra is not None and por_obra_contagem.get(obra, 0) >= por_obra:
            continue
        por_obra_contagem[obra] = por_obra_contagem.get(obra, 0) + 1
        escolhidos.append(i)
        if limite is not None and len(escolhidos) >= limite:
            break
    saida: list[Citacao] = []
    for i in escolhidos:
        linha = con.execute(
            "select t.id, t.obra_id, t.pagina, t.paragrafo, t.texto, t.idioma, o.titulo, o.autor, o.arquivo"
            " from trecho t join obra o on o.id = t.obra_id where t.id = ?",
            (ids[i],),
        ).fetchone()
        if linha is None:
            continue
        saida.append(Citacao(
            trecho_id=linha["id"], obra_id=linha["obra_id"], arquivo=linha["arquivo"], titulo=linha["titulo"],
            autor=linha["autor"], idioma=linha["idioma"], pagina=linha["pagina"], paragrafo=linha["paragrafo"],
            texto=linha["texto"], score=0.0, proveniencia="nao_verificada",
        ))
    return saida
