from __future__ import annotations

import hashlib
import sqlite3
import traceback
import uuid
from pathlib import Path

import numpy as np

from . import avaliacao, busca, embedder, parse
from .esquema import DIR_PDFS, gravar_metricas

FRACAO_AVALIACAO = 0.15
SEED = 42


def hash_arquivo(caminho: Path) -> str:
    digestor = hashlib.sha256()
    with caminho.open("rb") as arquivo:
        for pedaco in iter(lambda: arquivo.read(1 << 20), b""):
            digestor.update(pedaco)
    return digestor.hexdigest()


def registar_obra(
    con: sqlite3.Connection,
    caminho: Path,
    titulo: str,
    autor: str,
    idioma: str,
    ano: int | None = None,
) -> tuple[str, str]:
    digest = hash_arquivo(caminho)
    existente = con.execute("select id from obra where arquivo_hash = ?", (digest,)).fetchone()
    if existente:
        return existente["id"], ""
    obra_id = str(uuid.uuid4())
    con.execute(
        "insert into obra (id, titulo, autor, ano, idioma, arquivo, arquivo_hash, status)"
        " values (?,?,?,?,?,?,?, 'pendente')",
        (obra_id, titulo, autor, ano, idioma, caminho.name, digest),
    )
    job_id = str(uuid.uuid4())
    con.execute(
        "insert into job (id, obra_id, status, etapa) values (?,?, 'pendente', 'na fila')",
        (job_id, obra_id),
    )
    con.commit()
    return obra_id, job_id


def _progresso(con: sqlite3.Connection, obra_id: str, **campos) -> None:
    if not campos:
        return
    atribuicoes = ", ".join(f"{chave} = ?" for chave in campos)
    con.execute(
        f"update job set {atribuicoes} where obra_id = ?", (*campos.values(), obra_id)
    )
    con.commit()


def processar(con: sqlite3.Connection, obra_id: str, modelo: str = embedder.PADRAO) -> dict:
    obra = con.execute("select * from obra where id = ?", (obra_id,)).fetchone()
    caminho = DIR_PDFS / obra["arquivo"]
    con.execute("update obra set status = 'processando' where id = ?", (obra_id,))
    con.commit()
    _progresso(con, obra_id, status="processando", etapa="a ler o PDF")
    try:
        blocos, paginas = parse.extrair(caminho)
        if not blocos:
            raise ValueError("nenhum texto extraido do PDF")
        con.execute("update obra set paginas = ? where id = ?", (paginas, obra_id))
        _progresso(
            con, obra_id, etapa="a calcular embeddings", paginas_totais=paginas, paginas_feitas=0
        )

        aleatorio = np.random.default_rng(SEED)
        marcas = aleatorio.random(len(blocos)) < FRACAO_AVALIACAO

        lote = 64
        for inicio in range(0, len(blocos), lote):
            fatia = blocos[inicio : inicio + lote]
            vetores = embedder.codificar_documentos([b.texto for b in fatia], modelo)
            con.executemany(
                "insert into trecho (id, obra_id, pagina, paragrafo, texto, idioma, avaliacao, embedding)"
                " values (?,?,?,?,?,?,?,?)",
                [
                    (
                        str(uuid.uuid4()),
                        obra_id,
                        bloco.pagina,
                        bloco.paragrafo,
                        bloco.texto,
                        obra["idioma"],
                        int(marcas[inicio + deslocamento]),
                        vetores[deslocamento].tobytes(),
                    )
                    for deslocamento, bloco in enumerate(fatia)
                ],
            )
            con.commit()
            _progresso(con, obra_id, paginas_feitas=min(fatia[-1].pagina, paginas))

        con.execute(
            "update obra set status = 'pronto', modelo = ?, erro = null where id = ?",
            (modelo, obra_id),
        )
        con.commit()
        _progresso(con, obra_id, etapa="a avaliar", paginas_feitas=paginas)
        busca.INDICE.modelo = modelo
        busca.INDICE.recarregar(con)
        resultado = avaliar_obra(con, obra_id, modelo)
        gravar_metricas(con, obra_id, resultado)
        _progresso(con, obra_id, status="pronto", etapa="concluido")
        return resultado
    except Exception as erro:
        traceback.print_exc()
        con.execute(
            "update obra set status = 'falhou', erro = ? where id = ?", (str(erro), obra_id)
        )
        con.commit()
        _progresso(con, obra_id, status="falhou", etapa="falhou", erro=str(erro))
        return {"erro": str(erro)}


def avaliar_obra(con: sqlite3.Connection, obra_id: str, modelo: str) -> dict:
    linhas = con.execute(
        "select id, obra_id, texto, idioma from trecho where obra_id = ? and avaliacao = 1",
        (obra_id,),
    ).fetchall()
    trechos = [dict(linha) for linha in linhas]
    consultas = avaliacao.gerar_consultas(trechos, seed=SEED)
    if not consultas:
        return {"consultas": 0, "aviso": "sem frases longas o suficiente"}
    vetores = embedder.codificar_consultas([c["consulta"] for c in consultas], modelo)
    posicoes: list[int | None] = []
    for vetor, consulta in zip(vetores, consultas):
        ordenados = [tid for tid, _ in busca.INDICE.buscar(vetor, 10, None, [consulta["consulta"]])]
        posicoes.append(avaliacao.posicao_do_alvo(ordenados, consulta["trecho_id"]))
    resultado = avaliacao.metricas(posicoes)
    resultado["modelo"] = modelo
    return resultado
