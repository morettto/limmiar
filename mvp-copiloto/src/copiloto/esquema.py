from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Literal

Idioma = Literal["pt-BR", "es", "en-US"]
StatusObra = Literal["pendente", "processando", "pronto", "falhou"]

RAIZ = Path(__file__).resolve().parents[2]
CORPUS = os.environ.get("COPILOTO_CORPUS", "")
DIR_DADOS = RAIZ / "data" / CORPUS if CORPUS else RAIZ / "data"
CAMINHO_BD = DIR_DADOS / "acervo.db"
DIR_PDFS = DIR_DADOS / "pdfs"

ESQUEMA = """
create table if not exists obra (
    id            text primary key,
    titulo        text not null,
    autor         text not null,
    ano           integer,
    idioma        text not null,
    arquivo       text not null,
    arquivo_hash  text not null unique,
    paginas       integer not null default 0,
    status        text not null default 'pendente',
    erro          text,
    metricas      text,
    modelo        text,
    criado_em     text not null default (datetime('now'))
);

create table if not exists trecho (
    id            text primary key,
    obra_id       text not null references obra(id) on delete cascade,
    pagina        integer not null,
    paragrafo     integer not null,
    texto         text not null,
    idioma        text not null,
    avaliacao     integer not null default 0,
    embedding     blob
);

create index if not exists idx_trecho_obra on trecho(obra_id);
create index if not exists idx_obra_status on obra(status);

create table if not exists job (
    id             text primary key,
    obra_id        text not null references obra(id) on delete cascade,
    status         text not null,
    paginas_feitas integer not null default 0,
    paginas_totais integer not null default 0,
    etapa          text not null default 'na fila',
    erro           text
);

create table if not exists citacao_servida (
    id         text primary key,
    trecho_id  text not null references trecho(id),
    score      real not null,
    servido_em text not null default (datetime('now'))
);
"""


@dataclass(frozen=True)
class Citacao:
    trecho_id: str
    obra_id: str
    arquivo: str
    titulo: str
    autor: str
    idioma: str
    pagina: int
    paragrafo: int
    texto: str
    score: float
    proveniencia: str

    def para_json(self) -> dict:
        return asdict(self)


def conectar() -> sqlite3.Connection:
    CAMINHO_BD.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(CAMINHO_BD, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("pragma foreign_keys = on")
    con.execute("pragma journal_mode = wal")
    return con


def criar_esquema(con: sqlite3.Connection) -> None:
    con.executescript(ESQUEMA)
    con.commit()


def gravar_metricas(con: sqlite3.Connection, obra_id: str, metricas: dict) -> None:
    con.execute(
        "update obra set metricas = ? where id = ?",
        (json.dumps(metricas, ensure_ascii=False), obra_id),
    )
    con.commit()
