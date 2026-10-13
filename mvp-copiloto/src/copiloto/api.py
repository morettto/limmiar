from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from . import acervo_profissional, continuacao, decisao, embedder, juiz_llm, metadados, qualificacao, traducao, votos

app = FastAPI(title="Copiloto Limmiar")
if ORIGEM_APP := os.environ.get("COPILOTO_APP_ORIGEM"):
    app.add_middleware(CORSMiddleware, allow_origins=[ORIGEM_APP], allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Authorization", "Content-Type"])
VERSAO = metadados.versao()
ESTADO_INICIAL = metadados.estado_arquivos()
trava_inferencia = threading.Lock()
trava_votos = threading.Lock()
MAX_CORPO_VOTO = 16 * 1024


@app.on_event("startup")
def arrancar() -> None:
    log = logging.getLogger("uvicorn.error")
    log.info("Carregando o modelo de busca %s", embedder.PADRAO)
    embedder.carregar()
    log.info("Carregando os modelos de tradução")
    traducao.aquecer()


class CorpoConsulta(BaseModel):
    frase: str = Field(min_length=1, max_length=2000)
    idioma: Annotated[str, Field(max_length=35, pattern=r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{1,8})*$")] = "pt-BR"
    falante: Literal["paciente", "terapeuta", "desconhecido"] = "paciente"
    contexto: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=5)
    cursor: str | None = Field(default=None, min_length=48, max_length=48)
    accountId: UUID | None = None
    materialIds: list[UUID] | None = None

    @field_validator("idioma")
    @classmethod
    def idioma_do_acervo(cls, idioma: str) -> str:
        # O app manda o locale da interface; sem acervo nem tradução para o idioma, a busca roda em inglês.
        return {"pt": "pt-BR", "es": "es"}.get(idioma.replace("_", "-").split("-")[0].lower(), "en-US")

    @field_validator("frase")
    @classmethod
    def frase_nao_vazia(cls, frase: str) -> str:
        if not frase.strip():
            raise ValueError("frase vazia")
        return frase


def _qualificado() -> bool:
    try:
        return (juiz_llm.configurado() and metadados.estado_arquivos() == ESTADO_INICIAL
                and qualificacao.qualificado(juiz_llm.VERSAO))
    except OSError:
        return False


@app.get("/api/saude")
def saude() -> dict:
    return {
        "qualificado": _qualificado(),
        "juiz_llm": {"versao": juiz_llm.VERSAO, "no_ar": juiz_llm.no_ar()},
        "limiares": decisao.limiares(),
        **VERSAO,
    }


@app.get("/api/acervo/{account_id}")
def acervo_pessoal(account_id: UUID, authorization: str | None = Header(default=None)) -> dict:
    acervo_profissional.materiais_autorizados(str(account_id), authorization)
    return {"materials": acervo_profissional.ACERVO.listar(str(account_id))}


@app.post("/api/acervo/{account_id}/{material_id}/preparar")
async def preparar_material(account_id: UUID, material_id: UUID, request: Request,
                            authorization: str | None = Header(default=None)) -> dict:
    authorized = await asyncio.to_thread(acervo_profissional.materiais_autorizados, str(account_id), authorization)
    if str(material_id) not in authorized:
        acervo_profissional.falhar("material.not_authorized", 404)
    data, fields = await acervo_profissional.multipart_em_memoria(request)
    try:
        material = await asyncio.to_thread(_preparar_em_ram, str(account_id), str(material_id), data, fields)
    except HTTPException:
        raise
    except Exception:
        acervo_profissional.falhar("material.processing_failed", 503)
    current = await asyncio.to_thread(acervo_profissional.materiais_autorizados, str(account_id), authorization)
    if str(material_id) not in current:
        acervo_profissional.ACERVO.remover(str(account_id), str(material_id))
        acervo_profissional.falhar("material.not_authorized", 404)
    return material.status()


def _preparar_em_ram(owner: str, material_id: str, data: bytes, fields: dict):
    with trava_inferencia:
        return acervo_profissional.ACERVO.preparar(owner, material_id, data, fields)


@app.delete("/api/acervo/{account_id}/{material_id}")
def remover_material(account_id: UUID, material_id: UUID, authorization: str | None = Header(default=None)) -> Response:
    acervo_profissional.materiais_autorizados(str(account_id), authorization)
    acervo_profissional.ACERVO.remover(str(account_id), str(material_id))
    return Response(status_code=204)


@app.post("/api/consultar-qualificado")
def consultar_qualificado(corpo: CorpoConsulta, authorization: str | None = Header(default=None)) -> StreamingResponse:
    if not _qualificado():
        raise HTTPException(status_code=503, detail="versão do juiz sem promoção registrada")
    if corpo.accountId is None or corpo.materialIds is None:
        acervo_profissional.falhar("material.unauthorized", 401)
    owner = str(corpo.accountId)
    ids = [str(id_) for id_ in corpo.materialIds]
    authorized = acervo_profissional.materiais_autorizados(owner, authorization)
    if any(id_ not in authorized for id_ in ids):
        acervo_profissional.falhar("material.not_authorized", 404)
    snapshot = acervo_profissional.ACERVO.snapshot(owner, ids)
    limites = decisao.limiares()
    vinculo = {"consulta": corpo.model_dump(mode="json", exclude={"cursor"}), "versao": VERSAO,
              "limiares": limites, "acervo": snapshot.signature()}
    try:
        inicio_fonte = continuacao.abrir(corpo.cursor, vinculo) if corpo.cursor is not None else 0
    except ValueError as erro:
        snapshot.connection.close()
        raise HTTPException(status_code=422, detail="continuação inválida para esta consulta") from erro
    cancelada = threading.Event()
    resultados = decisao.decidir_progressivamente(snapshot.connection, corpo.frase, corpo.contexto, corpo.falante,
                                                 corpo.idioma, ids, limites, cancelada.is_set, inicio_fonte,
                                                 indice=snapshot.index, verificar_proveniencia=snapshot.proveniencia)

    def proximo():
        with trava_inferencia:
            if cancelada.is_set():
                return None
            if not _qualificado():
                raise RuntimeError("Os artefatos mudaram durante a consulta")
            current = acervo_profissional.materiais_autorizados(owner, authorization)
            if any(id_ not in current for id_ in ids):
                raise RuntimeError("Autorização do acervo alterada")
            resultado = next(resultados, None)
            if resultado is not None and not _qualificado():
                raise RuntimeError("Os artefatos mudaram durante a consulta")
            current = acervo_profissional.materiais_autorizados(owner, authorization)
            if any(id_ not in current for id_ in ids):
                raise RuntimeError("Autorização do acervo alterada")
            return resultado

    async def transmitir():
        try:
            if (resultado := await asyncio.to_thread(proximo)) is not None:
                dados = resultado.para_json()
                dados.pop("candidatos", None)
                if not resultado.completo:
                    dados["cursor"] = continuacao.emitir(resultado.fontes_avaliadas, vinculo)
                yield json.dumps(dados, ensure_ascii=False) + "\n"
        except (ValueError, RuntimeError, OSError, HTTPException):
            yield json.dumps({"erro": "insight.indisponivel", "juiz": juiz_llm.VERSAO}) + "\n"
        finally:
            cancelada.set()
            snapshot.connection.close()

    return StreamingResponse(transmitir(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})




def _anexar_voto(linha: str) -> None:
    with trava_votos:
        votos.ARQUIVO.parent.mkdir(parents=True, exist_ok=True)
        with votos.ARQUIVO.open("a", encoding="utf-8") as f:
            f.write(linha)


@app.post("/api/votos")
async def registrar_voto(request: Request, accountId: UUID, authorization: str | None = Header(default=None)) -> Response:
    # Nunca logar o corpo nem `usuario`: o voto traz a fala do paciente (dado de saúde).
    await asyncio.to_thread(acervo_profissional.materiais_autorizados, str(accountId), authorization)
    bruto = await request.body()
    try:
        evento = json.loads(bruto) if len(bruto) <= MAX_CORPO_VOTO else None
    except ValueError:
        evento = None
    if not votos.valido(evento) or not votos.dentro_dos_limites(evento):
        raise HTTPException(status_code=400, detail="voto invalido")
    await asyncio.to_thread(_anexar_voto, json.dumps(evento, ensure_ascii=False) + "\n")
    return Response(status_code=204)
