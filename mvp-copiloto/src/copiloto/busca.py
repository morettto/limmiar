from __future__ import annotations

import sqlite3
import threading
import time

import numpy as np
from pypdf.errors import PdfReadError

from . import embedder, parse, trecho
from .esquema import Citacao, DIR_PDFS


class Indice:
    def __init__(self) -> None:
        self._trava = threading.Lock()
        self.ids: list[str] = []
        self.obras: np.ndarray = np.empty(0, dtype=object)
        self.matriz: np.ndarray = np.zeros((0, 0), dtype=np.float32)
        self.carregado_em: float = 0.0

    def recarregar(self, con: sqlite3.Connection) -> None:
        outros = {linha["modelo"] for linha in con.execute("select distinct modelo from obra where status = 'pronto'")}
        if outros - {embedder.PADRAO}:
            raise ValueError(f"trechos codificados com {sorted(map(str, outros))}, não com {embedder.PADRAO}: ingira de novo")
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
            else:
                self.ids = [linha["id"] for linha in linhas]
                self.obras = np.array([linha["obra_id"] for linha in linhas], dtype=object)
                self.matriz = np.vstack(
                    [np.frombuffer(linha["embedding"], dtype=np.float32) for linha in linhas]
                )
            self.carregado_em = time.time()

    def vazio(self) -> bool:
        return self.matriz.size == 0

    def buscar(self, vetor: np.ndarray, limite: int, obras_ids: list[str] | None) -> list[tuple[str, float]]:
        with self._trava:
            if self.matriz.size == 0:
                return []
            matriz, ids, obras = self.matriz, self.ids, self.obras
        permitidos = np.arange(len(ids))
        if obras_ids is not None:
            permitidos = np.flatnonzero(np.isin(obras, np.array(obras_ids, dtype=object)))
            if permitidos.size == 0:
                return []
        scores = matriz[permitidos] @ vetor
        ordem = np.argsort(-scores)[:limite]
        return [(ids[permitidos[p]], float(scores[p])) for p in ordem]


def fundir_rrf(*ordens: list[int], k: int, constante: int = 60) -> list[int]:
    pontos: dict[int, float] = {}
    for ordem in ordens:
        for posicao, indice in enumerate(ordem):
            pontos[indice] = pontos.get(indice, 0.0) + 1.0 / (constante + posicao + 1)
    return [i for i, _ in sorted(pontos.items(), key=lambda par: -par[1])[:k]]


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


def candidatos_amplos(
    con: sqlite3.Connection,
    frase: str,
    limite: int | None = None,
    obras_ids: list[str] | None = None,
    por_obra: int | None = None,
    profundidade: int | None = None,
    extras: list[str] | None = None,
    indice: Indice | None = None,
) -> list[Citacao]:
    # Dense only, statement plus the LLM rewrite: translation and BM25 added nothing on the gold (anchor in top-40: 81
    # with or without them) and cost a translation model and a lexical index per snapshot.
    textos = [frase, *(e for e in (extras or []) if e.strip())]
    fonte = indice if indice is not None else INDICE
    with fonte._trava:
        if fonte.matriz.size == 0:
            return []
        matriz, ids, obras = fonte.matriz, fonte.ids, fonte.obras
    permitidos = np.arange(len(ids))
    if obras_ids is not None:
        permitidos = np.flatnonzero(np.isin(obras, np.array(obras_ids, dtype=object)))
        if permitidos.size == 0:
            return []
    n = min(profundidade or permitidos.size, permitidos.size)
    listas: list[list[int]] = []
    for vetor in embedder.codificar_consultas(textos):
        scores = matriz[permitidos] @ vetor
        topo = np.argpartition(-scores, n - 1)[:n]
        listas.append([int(permitidos[p]) for p in topo[np.argsort(-scores[topo])]])
    escolhidos: list[int] = []
    por_obra_contagem: dict[str, int] = {}
    for i in fundir_rrf(*listas, k=n * len(listas)):
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
            "select t.id, t.obra_id, t.pagina, t.paragrafo, t.texto, t.idioma, t.generico, o.titulo, o.autor, o.arquivo"
            " from trecho t join obra o on o.id = t.obra_id where t.id = ?",
            (ids[i],),
        ).fetchone()
        if linha is None:
            continue
        saida.append(Citacao(
            trecho_id=linha["id"], obra_id=linha["obra_id"], arquivo=linha["arquivo"], titulo=linha["titulo"],
            autor=linha["autor"], idioma=linha["idioma"], pagina=linha["pagina"], paragrafo=linha["paragrafo"],
            texto=linha["texto"], score=0.0, proveniencia="nao_verificada", generico=linha["generico"],
        ))
    return saida
