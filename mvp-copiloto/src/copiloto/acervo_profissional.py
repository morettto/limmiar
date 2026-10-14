"""Materiais pessoais em RAM, autorizados pela API de produto em cada operação."""
from __future__ import annotations

import hashlib
import io
import logging
import json
import os
import sqlite3
import threading
import time
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

import httpx
import numpy as np
from fastapi import HTTPException, Request
from pypdf import PdfReader
from python_multipart.multipart import MultipartParser, parse_options_header

from . import busca, embedder, parse
from .esquema import criar_esquema

API_PRODUTO = os.environ.get("COPILOTO_API_URL", "http://127.0.0.1:5259").rstrip("/")
MAX_BYTES = 20 * 1024 * 1024


def falhar(code: str, status: int = 400):
    raise HTTPException(status_code=status, detail={"code": code})


def materiais_da_conta(account_id: str, authorization: str | None) -> dict[str, dict]:
    if not isinstance(authorization, str) or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        falhar("material.unauthorized", 401)
    try:
        account_id = str(UUID(account_id))
        response = httpx.get(f"{API_PRODUTO}/accounts/{account_id}/materials", headers={"Authorization": authorization}, timeout=5)
    except ValueError:
        falhar("material.unauthorized", 401)
    except httpx.HTTPError:
        falhar("material.unavailable", 503)
    if response.status_code in (401, 403):
        falhar("material.unauthorized", response.status_code)
    if response.status_code != 200:
        falhar("material.unavailable", 503)
    try:
        materials = response.json()["materials"]
        if any(not isinstance(item, dict) or not isinstance(item.get("authorized"), bool) for item in materials):
            raise ValueError("invalid materials")
        items = {str(UUID(item["materialId"])): item for item in materials}
    except (KeyError, ValueError, TypeError):
        falhar("material.unavailable", 503)
    ACERVO.reconciliar(account_id, items)
    return items


def materiais_autorizados(account_id: str, authorization: str | None) -> dict[str, dict]:
    return {id_: item for id_, item in materiais_da_conta(account_id, authorization).items() if item["authorized"] is True}


async def multipart_em_memoria(request: Request) -> tuple[bytes, dict[str, str]]:
    _, params = parse_options_header(request.headers.get("content-type", ""))
    boundary = params.get(b"boundary")
    if not boundary or len(boundary) > 200:
        falhar("material.invalid_upload")
    fields: dict[str, bytearray] = {}
    headers: dict[bytes, bytes] = {}
    current_header = bytearray()
    current_value = bytearray()
    current_name = ""
    finished = False

    def part_begin():
        nonlocal current_name
        headers.clear(); current_name = ""

    def header_field(data, start, end):
        current_header.extend(data[start:end])

    def header_value(data, start, end):
        current_value.extend(data[start:end])

    def header_end():
        headers[bytes(current_header).lower()] = bytes(current_value)
        current_header.clear(); current_value.clear()

    def headers_finished():
        nonlocal current_name
        _, options = parse_options_header(headers.get(b"content-disposition", b""))
        current_name = options.get(b"name", b"").decode("utf-8")
        if current_name not in {"file", "titulo", "autores", "tipo", "sha256"} or current_name in fields:
            falhar("material.invalid_upload")
        fields[current_name] = bytearray()

    def part_data(data, start, end):
        fields[current_name].extend(data[start:end])
        limit = MAX_BYTES if current_name == "file" else 4096
        if len(fields[current_name]) > limit:
            falhar("material.too_large", 413)

    def complete():
        nonlocal finished
        finished = True

    parser = MultipartParser(boundary, {"on_part_begin": part_begin, "on_header_field": header_field,
        "on_header_value": header_value, "on_header_end": header_end, "on_headers_finished": headers_finished,
        "on_part_data": part_data, "on_end": complete})
    total = 0
    try:
        async for chunk in request.stream():
            total += len(chunk)
            if total > MAX_BYTES + 16384:
                falhar("material.too_large", 413)
            parser.write(chunk)
        parser.finalize()
        if not finished or set(fields) != {"file", "titulo", "autores", "tipo", "sha256"}:
            falhar("material.invalid_upload")
        return bytes(fields["file"]), {key: bytes(value).decode("utf-8") for key, value in fields.items() if key != "file"}
    except (UnicodeError, ValueError, KeyError):
        falhar("material.invalid_upload")


@dataclass(frozen=True)
class Material:
    id: str
    title: str
    authors: str
    sha256: str
    pages: tuple[str, ...]
    blocks: tuple[parse.Bloco, ...]
    embeddings: np.ndarray
    model: str
    prepared_at: str

    def status(self) -> dict:
        return {"materialId": self.id, "ready": True, "sha256": self.sha256,
                "paragraphs": len(self.blocks), "preparedAt": self.prepared_at}


@dataclass
class Snapshot:
    connection: sqlite3.Connection
    index: busca.Indice
    materials: tuple[Material, ...]

    def proveniencia(self, arquivo: str, pagina: int, texto: str) -> bool:
        material = next((item for item in self.materials if item.id == arquivo), None)
        return bool(material and 1 <= pagina <= len(material.pages) and texto.strip()
                    and " ".join(texto.split()) in " ".join(material.pages[pagina - 1].split()))

    def signature(self) -> list[dict]:
        return [{"id": item.id, "hash": item.sha256, "model": item.model} for item in self.materials]


class Acervo:
    def __init__(self):
        self._lock = threading.RLock()
        self._owners: dict[str, dict[str, Material]] = {}

    def reconciliar(self, owner: str, authorized: dict[str, dict]):
        with self._lock:
            if owner in self._owners:
                self._owners[owner] = {id_: item for id_, item in self._owners[owner].items() if id_ in authorized}

    def remover(self, owner: str, id_: str):
        with self._lock:
            self._owners.get(owner, {}).pop(id_, None)

    def listar(self, owner: str) -> list[dict]:
        with self._lock:
            return [item.status() for item in self._owners.get(owner, {}).values()]

    def preparar(self, owner: str, id_: str, data: bytes, fields: dict[str, str], trava_modelo=None,
                 progresso: Callable[[str, int, int], None] | None = None) -> Material:
        inicio_preparo = time.perf_counter()
        if not data or len(data) > MAX_BYTES:
            falhar("material.too_large", 413)
        digest = hashlib.sha256(data).hexdigest()
        if fields["sha256"] != digest:
            falhar("material.hash_mismatch")
        if not fields["titulo"].strip() or not fields["autores"].strip():
            falhar("material.invalid_metadata")
        try:
            if fields["tipo"] == "pdf" and data.startswith(b"%PDF-"):
                reader = PdfReader(io.BytesIO(data))
                total_paginas = len(reader.pages)
                extraidas = []
                if progresso and total_paginas: progresso("leitura", 0, total_paginas)
                for numero, page in enumerate(reader.pages, 1):
                    extraidas.append(parse._limpar(page.extract_text() or ""))
                    if progresso: progresso("leitura", numero, total_paginas)
                pages = tuple(extraidas)
            elif fields["tipo"] == "txt":
                pages = (parse._limpar(data.decode("utf-8")),)
                if "\0" in pages[0]:
                    falhar("material.invalid_upload")
            else:
                falhar("material.invalid_upload")
        except HTTPException:
            raise
        except Exception:
            falhar("material.processing_failed")
        blocks = []
        for page_number, text in enumerate(pages, 1):
            paragraph_number = 0
            for paragraph in parse._partir_paragrafos(text):
                while paragraph:
                    end = min(len(paragraph), parse.MAX_CARACTERES)
                    if end < len(paragraph):
                        space = paragraph.rfind(" ", 0, end)
                        if space > 0:
                            end = space
                    part, paragraph = paragraph[:end].strip(), paragraph[end:].strip()
                    if part:
                        paragraph_number += 1
                        blocks.append(parse.Bloco(page_number, paragraph_number, part))
        if not blocks:
            falhar("material.no_text")
        model = embedder.PADRAO
        inicio_embedding = time.perf_counter()
        textos = list(dict.fromkeys(block.texto for block in blocks))
        ordem = sorted(range(len(textos)), key=lambda indice: len(textos[indice]), reverse=True)
        if progresso: progresso("referencias", 0, len(textos))
        lotes = []
        for inicio in range(0, len(textos), 8):
            with trava_modelo if trava_modelo is not None else nullcontext():
                lotes.append(embedder.codificar_documentos(
                    [textos[indice] for indice in ordem[inicio:inicio + 8]], model, lote=8))
            if progresso: progresso("referencias", min(inicio + 8, len(textos)), len(textos))
        unicos = np.concatenate(lotes)[np.argsort(ordem)]
        indices = {texto: indice for indice, texto in enumerate(textos)}
        vectors = unicos[[indices[block.texto] for block in blocks]]
        material = Material(id_, fields["titulo"].strip(), fields["autores"].strip(), digest, pages,
                            tuple(blocks), vectors, model, datetime.now(timezone.utc).isoformat())
        with self._lock:
            self._owners.setdefault(owner, {})[id_] = material
        logging.getLogger("uvicorn.error").info(json.dumps({"event": "material_prepared", "materialId": id_,
            "pages": len(pages), "paragraphs": len(blocks), "unique_paragraphs": len(textos), "bytes": len(data),
            "extraction_ms": round((inicio_embedding - inicio_preparo) * 1000),
            "embedding_ms": round((time.perf_counter() - inicio_embedding) * 1000),
            "device": os.environ.get("COPILOTO_EMBEDDER_DISPOSITIVO", "cpu")}))
        return material

    def snapshot(self, owner: str, ids: list[str]) -> Snapshot:
        with self._lock:
            owned = self._owners.get(owner, {})
            if any(id_ not in owned for id_ in ids):
                falhar("material.not_ready", 409)
            materials = tuple(owned[id_] for id_ in sorted(set(ids)))
        connection = sqlite3.connect(":memory:", check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("pragma temp_store = memory")
        criar_esquema(connection)
        for material in materials:
            connection.execute("INSERT INTO obra (id,titulo,autor,idioma,arquivo,arquivo_hash,paginas,status,modelo) VALUES (?,?,?,'pt-BR',?,?,?,'pronto',?)",
                               (material.id, material.title, material.authors, material.id, material.id + material.sha256, len(material.pages), material.model))
            for block, vector in zip(material.blocks, material.embeddings, strict=True):
                connection.execute("INSERT INTO trecho (id,obra_id,pagina,paragrafo,texto,idioma,embedding) VALUES (?,?,?,?,?,'pt-BR',?)",
                    (f"{material.id}:{block.pagina}:{block.paragrafo}", material.id, block.pagina, block.paragrafo, block.texto, vector.tobytes()))
        connection.commit()
        index = busca.Indice()
        index.recarregar(connection)
        return Snapshot(connection, index, materials)


ACERVO = Acervo()
