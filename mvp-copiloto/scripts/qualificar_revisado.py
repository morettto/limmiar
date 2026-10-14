"""Congela a régua no desenvolvimento e mede um corpus de obras não vistas no treino."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import time
from collections import Counter
from contextlib import closing
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import avaliacao, busca, decisao, embedder, juiz, metadados, parse, treinado, traducao
from copiloto.esquema import CORPUS, DIR_PDFS, conectar
from avaliar import casos, resumo

DESTINO = RAIZ / f"resultados/qualificacao-{treinado.NOME_JUIZ}"
COTAS_CASOS = {"geral": 60, "risco": 20, "neutro": 80, "quase": 20, "terapeuta": 10, "ambiguo": 10}


def estrato(caso: dict) -> str:
    return caso["canal"] if caso["tipo"] == "positivo" else caso["tipo"]


def selecionar(lista: list[dict]) -> list[dict]:
    if len({c["id"] for c in lista}) != len(lista):
        raise ValueError("Casos duplicados")
    grupos = {tipo: [] for tipo in COTAS_CASOS}
    for caso in lista:
        grupos[estrato(caso)].append(caso)
    selecionados = []
    for tipo, total in COTAS_CASOS.items():
        ordenados = sorted(grupos[tipo], key=lambda c: hashlib.sha256(c["id"].encode()).hexdigest())
        if len(ordenados) < total:
            raise ValueError(f"Amostra insuficiente para {tipo}")
        selecionados.extend(ordenados[:total])
    return selecionados


def preparar() -> dict:
    if CORPUS != "teste":
        raise ValueError("Configure COPILOTO_CORPUS=teste para a prova independente")
    hashes_obras = []
    for bd in (RAIZ / "data/acervo.db", RAIZ / "data/teste/acervo.db"):
        with closing(sqlite3.connect(f"{bd.as_uri()}?mode=ro", uri=True)) as con:
            reais = set()
            for arquivo, esperado in con.execute("select arquivo,arquivo_hash from obra"):
                with (bd.parent / "pdfs" / arquivo).open("rb") as pdf:
                    real = hashlib.file_digest(pdf, "sha256").hexdigest()
                if real != esperado:
                    raise ValueError("PDF do corpus não corresponde ao índice avaliado")
                reais.add(real)
            hashes_obras.append(reais)
    if hashes_obras[0] & hashes_obras[1]:
        raise ValueError("Corpus de teste contém obra do desenvolvimento")
    caminho = DESTINO / "protocolo.json"
    calibracao = json.loads((RAIZ / f"resultados/calibracao-contexto-{treinado.NOME_JUIZ}.json").read_text(encoding="utf-8"))
    if calibracao["calibracao_aprovada"] is not True:
        raise ValueError("Desenvolvimento não passou na calibração fora-da-parte")
    # A régua é congelada antes de qualquer resultado do conjunto independente.
    limite = calibracao["selecionado"]["limiar"]
    triagem = decisao.limiares()
    limites = {**triagem, "juiz_geral": limite, "juiz_risco": limite}
    protocolo = {"modelo": treinado.NOME_JUIZ, "limiares": limites,
                 "calibracao_oof_sha256": calibracao["oof_sha256"], "cotas_casos": COTAS_CASOS,
                 "obras_treino_compartilhadas": [], "casos": selecionar(casos("teste"))}
    if caminho.exists():
        congelado = json.loads(caminho.read_text(encoding="utf-8"))
        if congelado != protocolo:
            raise ValueError("A régua congelada mudou; preserve a avaliação e use outra versão.")
        return congelado
    DESTINO.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(protocolo, ensure_ascii=False, indent=2), encoding="utf-8")
    return protocolo


def correr() -> None:
    protocolo = preparar()
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    treinado.aquecer()
    for linha in con.execute("select distinct o.arquivo,t.pagina from trecho t join obra o on o.id=t.obra_id"):
        parse.texto_da_pagina(DIR_PDFS / linha[0], linha[1])
    versao = metadados.versao_pesquisa()
    manifesto = {"versao": versao, "protocolo_sha256": hashlib.sha256((DESTINO / "protocolo.json").read_bytes()).hexdigest(),
                 "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    caminho_versao = DESTINO / "execucao.json"
    if caminho_versao.exists() and json.loads(caminho_versao.read_text(encoding="utf-8")) != manifesto:
        raise ValueError("Código, pesos, acervo ou protocolo mudaram; não reutilize esta avaliação")
    caminho_versao.write_text(json.dumps(manifesto, indent=2), encoding="utf-8")
    caminho_registos = DESTINO / "registos.jsonl"
    registos = [json.loads(l) for l in caminho_registos.read_text(encoding="utf-8").splitlines()] if caminho_registos.exists() else []
    concluidos = {r["id"] for r in registos}
    if len(concluidos) != len(registos) or concluidos - {c["id"] for c in protocolo["casos"]}:
        raise ValueError("Resultados duplicados ou fora do protocolo")
    with caminho_registos.open("a", encoding="utf-8") as arquivo:
        for caso in protocolo["casos"]:
            if caso["id"] in concluidos:
                continue
            inicio = time.perf_counter()
            primeira = primeiro_cartao = None
            ultima = None
            for d in decisao.decidir_progressivamente(con, caso["fala"], caso["contexto"], caso["falante"],
                                                      caso["idioma"], obras_ids=None, limites=protocolo["limiares"]):
                ms = round((time.perf_counter() - inicio) * 1000, 1)
                if primeira is None:
                    primeira = ms
                if d.cartoes and primeiro_cartao is None:
                    primeiro_cartao = ms
                ultima = d
            if ultima is None or ultima.completo is not True:
                raise ValueError("Consulta independente incompleta")
            for cartao in ultima.cartoes:
                if (not busca._proveniencia_ok(cartao.arquivo, cartao.pagina, cartao.texto)
                        or not juiz.citacao_confere(cartao.citacao_literal, cartao.texto)):
                    raise ValueError("Citação sem proveniência")
            saida = ultima.para_json()
            registro = {"id": caso["id"], "decisao": saida, "primeira_decisao_ms": primeira,
                        "primeiro_cartao_ms": primeiro_cartao, "total_ms": round((time.perf_counter() - inicio) * 1000, 1)}
            arquivo.write(json.dumps(registro, ensure_ascii=False) + "\n")
            arquivo.flush()
            registos.append(registro)
            print(f"{len(registos)}/{len(protocolo['casos'])}; {len(ultima.cartoes)} fontes; primeira decisão {primeira} ms", flush=True)
    if metadados.versao_pesquisa() != versao:
        raise ValueError("Artefatos mudaram durante a avaliação")
    relatorio = resumo(registos, protocolo["casos"], protocolo["limiares"], {})
    revisoes = relatorio.pop("a_adjudicar")
    (DESTINO / "adjudicar.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in revisoes), encoding="utf-8")
    tempos_cartoes = [r["primeiro_cartao_ms"] for r in registos if r["primeiro_cartao_ms"] is not None]
    primeiro_cartao_p95 = avaliacao.percentil(tempos_cartoes, 95) if tempos_cartoes else None
    relatorio.update({"status": "PENDENTE_ADJUDICACAO", "avaliacao_independente": True,
                      "falas_avaliadas": len(registos), "proveniencia_verificada": True,
                      "versao": versao, "casos_por_tipo": dict(Counter(estrato(c) for c in protocolo["casos"])),
                      "primeira_decisao_p95_ms": avaliacao.percentil([r["primeira_decisao_ms"] for r in registos], 95),
                      "primeiro_cartao_p95_ms": primeiro_cartao_p95,
                      "primeiro_cartao_p95_s": primeiro_cartao_p95 / 1000 if primeiro_cartao_p95 is not None else None})
    (DESTINO / "resumo.json").write_text(json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1:] == ["preparar"]:
        protocolo = preparar()
        print(json.dumps({"casos": len(protocolo["casos"]), "limiares": protocolo["limiares"]}, ensure_ascii=False))
    elif sys.argv[1:] == ["correr"]:
        correr()
    else:
        raise SystemExit("Use preparar ou correr")
