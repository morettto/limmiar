"""App de pesquisa: consulta o acervo de desenvolvimento sem autenticação, para os scripts e a página de avaliação.

Nunca vai para um ambiente exposto; o serviço de produto é `api.py`.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Annotated, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import busca, decisao, embedder, jev, juiz, metadados, parse, traducao, treinado
from .esquema import DIR_PDFS, conectar, criar_esquema

WEB = Path(__file__).resolve().parent / "web"
app = FastAPI(title="Pesquisa do copiloto Limmiar")
con = conectar()
criar_esquema(con)
VERSAO = metadados.versao_pesquisa()


@app.on_event("startup")
def arrancar() -> None:
    log = logging.getLogger("uvicorn.error")
    DIR_PDFS.mkdir(parents=True, exist_ok=True)
    log.info("Carregando o índice bibliográfico")
    busca.INDICE.recarregar(con)
    log.info("Carregando o modelo de busca %s", busca.INDICE.modelo)
    embedder.carregar(busca.INDICE.modelo)
    log.info("Carregando os modelos de tradução")
    traducao.aquecer()
    if decisao.decisor() == "treinado":
        log.info("Carregando triagem e juiz %s", treinado.NOME_JUIZ)
        treinado.aquecer()
    log.info("Verificando as páginas do acervo")
    for linha in con.execute(
        "select distinct o.arquivo, t.pagina from trecho t join obra o on o.id = t.obra_id"
    ).fetchall():
        parse.texto_da_pagina(DIR_PDFS / linha["arquivo"], linha["pagina"])


class CorpoPesquisa(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frase: str = Field(min_length=1, max_length=2000)
    obras_ids: list[str] | None = None
    idioma: Literal["pt-BR", "es", "en-US"] = "pt-BR"
    falante: Literal["paciente", "terapeuta", "desconhecido"] = "paciente"
    contexto: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=5)

    @field_validator("frase")
    @classmethod
    def frase_nao_vazia(cls, frase: str) -> str:
        if not frase.strip():
            raise ValueError("frase vazia")
        return frase


def _no_ar(url: str) -> bool:
    try:
        return httpx.get(f"{url}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


@app.get("/")
def raiz() -> FileResponse:
    return FileResponse(WEB / "index.html")


@app.get("/api/saude")
def saude() -> dict:
    return {
        "modelo": busca.INDICE.modelo,
        "trechos_no_indice": len(busca.INDICE.ids),
        "indice_vazio": busca.INDICE.vazio(),
        "juiz_no_ar": _no_ar(juiz.URL_JUIZ),
        "decisor": decisao.decisor(),
        "jev_configurado": jev.disponivel(),
        "limiares": decisao.limiares(),
        "juiz_modelo": treinado.NOME_JUIZ,
        "candidatos_juiz": len(busca.INDICE.ids),
        "fontes_por_lote": decisao.LOTE_FONTES,
        **VERSAO,
    }


@app.get("/api/acervo")
def acervo() -> list[dict]:
    linhas = con.execute(
        "select o.*, (select count(*) from trecho t where t.obra_id = o.id) as trechos"
        " from obra o order by o.criado_em desc"
    ).fetchall()
    saida = []
    for linha in linhas:
        item = dict(linha)
        item["metricas"] = json.loads(item["metricas"]) if item["metricas"] else None
        saida.append(item)
    return saida


@app.get("/api/jobs/{obra_id}")
def job(obra_id: str) -> dict:
    linha = con.execute("select * from job where obra_id = ?", (obra_id,)).fetchone()
    if linha is None:
        raise HTTPException(status_code=404, detail="job nao encontrado")
    item = dict(linha)
    total = item["paginas_totais"] or 0
    item["percentagem"] = round(100 * item["paginas_feitas"] / total) if total else 0
    return item


@app.post("/api/consultar")
def consultar(corpo: CorpoPesquisa) -> dict:
    if busca.INDICE.vazio():
        return {"cartoes": [], "alerta_risco": False, "clarificar": False, "canal": "nenhum",
                "motivo_silencio": "acervo vazio", "tempos_ms": {}, "triagem": None}
    try:
        resultado = decisao.decidir(
            con, corpo.frase, corpo.contexto, corpo.falante, corpo.idioma, corpo.obras_ids
        ).para_json()
    except ValueError as erro:
        raise HTTPException(status_code=422, detail=str(erro)) from erro
    resultado.pop("candidatos", None)
    return resultado
