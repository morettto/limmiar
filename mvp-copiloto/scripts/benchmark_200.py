from __future__ import annotations

import json
import os
import random
import sys
import time
from collections import Counter
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

from copiloto import busca, decisao, embedder, treinado
from copiloto.esquema import conectar, criar_esquema


SEMENTE = 20260929
TOTAL = 200
AVALIACAO = RAIZ / "data" / "avaliacao"
RESULTADOS = RAIZ / "resultados"
CASOS = AVALIACAO / "benchmark_200.jsonl"
REGISTOS = RESULTADOS / "benchmark_200_registos.jsonl"
RELATORIO = RESULTADOS / "benchmark_200.json"


def carregar_casos() -> list[dict]:
    linhas = [
        json.loads(linha)
        for linha in (AVALIACAO / "teste_positivos.jsonl").read_text(encoding="utf-8").splitlines()
        if linha.strip()
    ]
    if len(linhas) < TOTAL:
        raise RuntimeError(f"o conjunto de teste tem {len(linhas)} positivos; são necessários {TOTAL}")
    escolhidos = random.Random(SEMENTE).sample(linhas, TOTAL)
    escolhidos.sort(key=lambda item: item["id"])
    CASOS.write_text(
        "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in escolhidos),
        encoding="utf-8",
    )
    return escolhidos


def alvo(caso: dict) -> tuple[set[tuple[str, int]], tuple[str, int, int] | None]:
    paginas = {(item["arquivo"], item["pagina"]) for item in caso["alvos"]}
    fonte = caso.get("fonte")
    exato = None if not fonte else (fonte["arquivo"], fonte["pagina"], fonte["paragrafo"])
    return paginas, exato


def posicoes(candidatos, paginas, exato):
    pagina = None
    paragrafo = None
    for posicao, candidato in enumerate(candidatos):
        pagina_atual = (candidato.arquivo, candidato.pagina)
        exato_atual = (candidato.arquivo, candidato.pagina, candidato.paragrafo)
        if pagina is None and pagina_atual in paginas:
            pagina = posicao
        if paragrafo is None and exato is not None and exato_atual == exato:
            paragrafo = posicao
    return pagina, paragrafo


def percentagem(valor: int, total: int) -> float:
    return round(valor / total, 4) if total else 0.0


def main() -> None:
    casos = carregar_casos()
    con = conectar()
    criar_esquema(con)
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    treinado.aquecer()
    print(f"casos={len(casos)} modelo={busca.INDICE.modelo} juiz={treinado.NOME_JUIZ}", flush=True)

    niveis = (20, 50, 100)
    paginas = Counter()
    exatos = Counter()
    cartoes = 0
    cartoes_pagina = 0
    cartoes_exatos = 0
    tempos: list[float] = []
    distribuicao = Counter()
    registros = []

    for indice, caso in enumerate(casos, 1):
        paginas_alvo, exato_alvo = alvo(caso)
        busca_do_caso = {}
        for nivel in niveis:
            inicio = time.perf_counter()
            candidatos = busca.candidatos_amplos(
                con,
                caso["fala"],
                caso["idioma"],
                limite=nivel,
                profundidade=nivel,
                por_obra=1000,
            )
            busca_do_caso[nivel] = candidatos
            pagina, paragrafo = posicoes(candidatos, paginas_alvo, exato_alvo)
            if pagina is not None:
                paginas[nivel] += 1
            if paragrafo is not None:
                exatos[nivel] += 1

        inicio = time.perf_counter()
        resultado = decisao.decidir(
            con,
            caso["fala"],
            caso.get("contexto", []),
            caso.get("falante", "paciente"),
            caso["idioma"],
        )
        total_ms = (time.perf_counter() - inicio) * 1000
        tempos.append(total_ms)
        referencias = resultado.cartoes
        if referencias:
            cartoes += 1
            cartoes_pagina += any((c.arquivo, c.pagina) in paginas_alvo for c in referencias)
            cartoes_exatos += any((c.arquivo, c.pagina, c.paragrafo) == exato_alvo for c in referencias)
        distribuicao[caso["idioma"]] += 1
        registros.append(
            {
                "id": caso["id"],
                "fala": caso["fala"],
                "contexto": caso.get("contexto", []),
                "idioma": caso["idioma"],
                "fenomeno": caso.get("fenomeno"),
                "alvos": sorted([list(item) for item in paginas_alvo]),
                "fonte": list(exato_alvo) if exato_alvo else None,
                "posicao_pagina": {
                    str(nivel): posicoes(busca_do_caso[nivel], paginas_alvo, exato_alvo)[0]
                    for nivel in niveis
                },
                "posicao_paragrafo": {
                    str(nivel): posicoes(busca_do_caso[nivel], paginas_alvo, exato_alvo)[1]
                    for nivel in niveis
                },
                "cartoes": [vars(c) for c in referencias],
                "cartao_pagina_correta": any((c.arquivo, c.pagina) in paginas_alvo for c in referencias),
                "cartao_paragrafo_exato": any((c.arquivo, c.pagina, c.paragrafo) == exato_alvo for c in referencias),
                "motivo": resultado.motivo_silencio,
                "tempos_ms": resultado.tempos_ms,
                "total_ms": round(total_ms, 1),
            }
        )
        if indice % 10 == 0:
            print(f"{indice}/{len(casos)}", flush=True)

    REGISTOS.write_text(
        "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in registros),
        encoding="utf-8",
    )

    tempos_ordenados = sorted(tempos)
    p95 = tempos_ordenados[int(0.95 * (len(tempos_ordenados) - 1))]
    resumo = {
        "seed": SEMENTE,
        "casos": TOTAL,
        "corpus": "teste",
        "pdfs": len({item["alvos"][0][0] for item in registros}),
        "distribuicao_idioma": dict(distribuicao),
        "modelo_indice": busca.INDICE.modelo,
        "juiz": treinado.NOME_JUIZ,
        "recall_pagina": {f"top{nivel}": percentagem(paginas[nivel], TOTAL) for nivel in niveis},
        "recall_paragrafo_exato": {f"top{nivel}": percentagem(exatos[nivel], TOTAL) for nivel in niveis},
        "cartoes": cartoes,
        "cartoes_pagina_correta": cartoes_pagina,
        "cartoes_paragrafo_exato": cartoes_exatos,
        "taxa_cartao": percentagem(cartoes, TOTAL),
        "precisao_cartao_pagina": percentagem(cartoes_pagina, cartoes),
        "recall_cartao_pagina": percentagem(cartoes_pagina, TOTAL),
        "recall_cartao_paragrafo": percentagem(cartoes_exatos, TOTAL),
        "latencia_p50_ms": round(tempos_ordenados[len(tempos_ordenados) // 2], 1),
        "latencia_p95_ms": round(p95, 1),
        "meta_sinalizacao": 0.9,
        "passa_sinalizacao_top100": percentagem(paginas[100], TOTAL) >= 0.9,
        "passa_cartao_pagina": percentagem(cartoes_pagina, TOTAL) >= 0.9,
    }
    RELATORIO.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
