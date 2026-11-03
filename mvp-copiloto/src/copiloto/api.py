from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from . import acervo_profissional, decisao, embedder, juiz_pequeno, metadados, qualificacao, votos

app = FastAPI(title="Copiloto Limmiar")
if ORIGEM_APP := os.environ.get("COPILOTO_APP_ORIGEM"):
    app.add_middleware(CORSMiddleware, allow_origins=[ORIGEM_APP], allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Authorization", "Content-Type"])
VERSAO = metadados.versao()
ESTADO_INICIAL = metadados.estado_arquivos()
trava_votos = threading.Lock()
trava_preparos = threading.Lock()
preparos: dict[tuple[str, str], dict] = {}
MAX_CORPO_VOTO = 16 * 1024


@app.on_event("startup")
def arrancar() -> None:
    log = logging.getLogger("uvicorn.error")
    log.info("Carregando o modelo de busca %s", embedder.PADRAO)
    embedder.codificar_consultas(["Consulta sintética de aquecimento."])
    log.info("Carregando o juiz %s de %s", juiz_pequeno.VERSAO, juiz_pequeno.PASTA)
    juiz_pequeno.principal("Frase sintética de aquecimento.", ["Trecho sintético de aquecimento."])


class CorpoConsulta(BaseModel):
    frase: str = Field(min_length=1, max_length=2000)
    falante: Literal["paciente", "terapeuta", "desconhecido"] = "paciente"
    contexto: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=5)
    accountId: UUID | None = None
    materialIds: list[UUID] | None = None

    @field_validator("frase")
    @classmethod
    def frase_nao_vazia(cls, frase: str) -> str:
        if not frase.strip():
            raise ValueError("frase vazia")
        return frase


def _motivo() -> str | None:
    """Por que o copiloto não mostra cartões agora; None quando mostra. Não há juiz de reserva."""
    if not qualificacao.qualificado(juiz_pequeno.VERSAO):
        return f"a versão {juiz_pequeno.VERSAO!r} do juiz não tem limiar no registro"
    try:
        mudou = metadados.estado_arquivos() != ESTADO_INICIAL
    except OSError:
        mudou = True
    return "o código do copiloto mudou desde o início do processo" if mudou else None


@app.get("/api/saude")
def saude() -> dict:
    motivo = _motivo()
    return {
        "qualificado": motivo is None,
        "motivo": motivo,
        "promovida": qualificacao.promovida(juiz_pequeno.VERSAO),
        "limiares": decisao.limiares(),
        **VERSAO,
    }


@app.get("/api/acervo/{account_id}")
def acervo_pessoal(account_id: UUID, authorization: str | None = Header(default=None)) -> dict:
    owner = str(account_id)
    owned = acervo_profissional.materiais_da_conta(owner, authorization)
    with trava_preparos:
        estados = [status.copy() for (conta, id_), status in preparos.items() if conta == owner and id_ in owned]
    preparados = acervo_profissional.ACERVO.listar(owner)
    ids = {item["materialId"] for item in preparados}
    return {"materials": preparados + [item for item in estados if item["materialId"] not in ids]}


@app.post("/api/acervo/{account_id}/{material_id}/preparar", status_code=202)
async def preparar_material(account_id: UUID, material_id: UUID, request: Request,
                            background_tasks: BackgroundTasks,
                            authorization: str | None = Header(default=None)) -> dict:
    owned = await asyncio.to_thread(acervo_profissional.materiais_da_conta, str(account_id), authorization)
    if str(material_id) not in owned:
        acervo_profissional.falhar("material.not_found", 404)
    data, fields = await acervo_profissional.multipart_em_memoria(request)
    owner, id_ = str(account_id), str(material_id)
    key = (owner, id_)
    with trava_preparos:
        anterior = preparos.get(key)
        if anterior and anterior["stage"] != "falhou":
            return anterior.copy()
        if sum(item["stage"] != "falhou" for item in preparos.values()) >= 4:
            acervo_profissional.falhar("material.busy", 429)
        status = {"materialId": id_, "sha256": fields["sha256"], "ready": False, "stage": "aguardando"}
        preparos[key] = status
    background_tasks.add_task(_preparar_material, owner, id_, data, fields, authorization)
    return status.copy()


def _preparar_material(owner: str, id_: str, data: bytes, fields: dict, authorization: str | None):
    key = (owner, id_)
    try:
        with trava_preparos:
            preparos[key]["stage"] = "organizando"
        _preparar_em_ram(owner, id_, data, fields)
        current = acervo_profissional.materiais_da_conta(owner, authorization)
        if id_ not in current:
            acervo_profissional.ACERVO.remover(owner, id_)
        with trava_preparos:
            preparos.pop(key, None)
    except Exception as erro:
        logging.getLogger("uvicorn.error").warning(json.dumps({"event": "material_prepare_failed",
            "materialId": id_, "errorType": type(erro).__name__}))
        acervo_profissional.ACERVO.remover(owner, id_)
        with trava_preparos:
            preparos[key]["stage"] = "falhou"


def _preparar_em_ram(owner: str, material_id: str, data: bytes, fields: dict):
    inicio = time.perf_counter()
    def atualizar(fase: str, completo: int, total: int):
        with trava_preparos:
            preparos[(owner, material_id)]["progress"] = {"phase": fase, "completed": completo, "total": total}
        if completo == 0 or completo == total or completo % 64 == 0:
            logging.getLogger("uvicorn.error").info(json.dumps({"event": "material_preparation_progress",
                "materialId": material_id, "phase": fase, "completed": completo, "total": total,
                "elapsed_ms": round((time.perf_counter() - inicio) * 1000)}))
    return acervo_profissional.ACERVO.preparar(owner, material_id, data, fields, progresso=atualizar)


@app.delete("/api/acervo/{account_id}/{material_id}")
def remover_material(account_id: UUID, material_id: UUID, authorization: str | None = Header(default=None)) -> Response:
    acervo_profissional.materiais_da_conta(str(account_id), authorization)
    acervo_profissional.ACERVO.remover(str(account_id), str(material_id))
    return Response(status_code=204)


@app.post("/api/consultar-qualificado")
def consultar_qualificado(corpo: CorpoConsulta, authorization: str | None = Header(default=None)) -> StreamingResponse:
    if (motivo := _motivo()) is not None:
        raise HTTPException(status_code=503, detail=motivo)
    if corpo.accountId is None or corpo.materialIds is None:
        acervo_profissional.falhar("material.unauthorized", 401)
    owner = str(corpo.accountId)
    ids = [str(id_) for id_ in corpo.materialIds]
    authorized = acervo_profissional.materiais_autorizados(owner, authorization)
    if any(id_ not in authorized for id_ in ids):
        acervo_profissional.falhar("material.not_authorized", 404)
    snapshot = acervo_profissional.ACERVO.snapshot(owner, ids)
    limites = decisao.limiares()

    def autorizado() -> None:
        current = acervo_profissional.materiais_autorizados(owner, authorization)
        if any(id_ not in current for id_ in ids):
            raise RuntimeError("Autorização do acervo alterada")

    def decidir() -> decisao.Decisao:
        # Sem trava global: cada modelo protege a própria chamada, e consultas de sessões diferentes avançam juntas
        # pelas etapas (busca, juiz). Com a trava única, 6 sessões esperavam ~5 s de fila por consulta.
        if _motivo() is not None:
            raise RuntimeError("O juiz deixou de estar qualificado")
        autorizado()
        resultado = decisao.decidir(snapshot.connection, corpo.frase, corpo.contexto, corpo.falante, ids,
                                    limites, indice=snapshot.index, verificar_proveniencia=snapshot.proveniencia)
        if _motivo() is not None:
            raise RuntimeError("Os artefatos mudaram durante a consulta")
        autorizado()
        return resultado

    async def transmitir():
        try:
            dados = (await asyncio.to_thread(decidir)).para_json()
            dados.pop("candidatos", None)
            yield json.dumps(dados, ensure_ascii=False) + "\n"
        except (ValueError, RuntimeError, OSError, HTTPException):
            yield json.dumps({"erro": "insight.indisponivel", "juiz": juiz_pequeno.VERSAO}) + "\n"
        finally:
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
