from __future__ import annotations

import hashlib
import os
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from . import juiz_llm, treinado
from .esquema import CAMINHO_BD, DIR_PDFS, RAIZ


FONTES = Path(__file__).parent


def arquivos_modelo() -> list[Path]:
    return [*treinado.pasta(treinado.NOME_JUIZ).glob("*"), treinado.arquivo_triagem()]


def estado_arquivos() -> dict:
    estado = {}
    for arquivo in FONTES.glob("*.py"):
        stat = arquivo.stat()
        estado[str(arquivo)] = (stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
    return estado


def hash_indice() -> str | None:
    if not CAMINHO_BD.is_file():
        return None
    digest = hashlib.sha256()
    with closing(sqlite3.connect(f"{CAMINHO_BD.as_uri()}?mode=ro", uri=True)) as con:
        con.execute("begin")
        for tabela in ("obra", "trecho"):
            for linha in con.execute(f"select * from {tabela} order by id"):
                valores = [hashlib.sha256(v).hexdigest() if isinstance(v, bytes) else v for v in linha]
                digest.update(json.dumps([tabela, valores], ensure_ascii=False, separators=(",", ":")).encode())
                digest.update(b"\n")
    return digest.hexdigest()


def hashes(arquivos) -> dict[str, str]:
    saida = {}
    for arquivo in sorted(arquivos):
        if arquivo.is_file():
            with arquivo.open("rb") as stream:
                saida[arquivo.relative_to(RAIZ).as_posix()] = hashlib.file_digest(stream, "sha256").hexdigest()
    return saida


def versao() -> dict:
    return {
        "contrato": "fontes-progressivas-frase-v4",
        "source_hashes": hashes(FONTES.glob("*.py")),
        "juiz": juiz_llm.VERSAO,
        "dispositivo_embedder": os.environ.get("COPILOTO_EMBEDDER_DISPOSITIVO", "cpu"),
        "dtype_embedder": "float16" if os.environ.get("COPILOTO_EMBEDDER_DISPOSITIVO", "cpu").startswith("cuda") else "float32",
    }


def versao_pesquisa() -> dict:
    return {
        **versao(),
        "model_hashes": hashes(arquivos_modelo()),
        "pdf_hashes": hashes(DIR_PDFS.glob("*.pdf")),
        "indice_sha256": hash_indice(),
        "dispositivo_juiz": os.environ.get("COPILOTO_JUIZ_DISPOSITIVO", "cuda"),
        "dtype_juiz": os.environ.get("COPILOTO_JUIZ_DTYPE", "float32"),
    }
