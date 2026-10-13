"""Segunda ronda: mede o ganho de cada camada sobre o mesmo corpus e as mesmas perguntas.

Camadas:
  A  denso puro                         (o que a ronda 1 mediu)
  B  denso + BM25 fundidos por RRF
  C  denso + BM25 + reranker cross-encoder sobre o top-30

Mede tambem a latencia de cada camada, que e o que decide se ela cabe na sessao.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import avaliacao, embedder, hibrido  # noqa: E402
from copiloto.esquema import conectar, criar_esquema  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
SONDAS = json.loads((RAIZ / "data" / "probes.json").read_text(encoding="utf-8"))["sondas"]
RESULTADOS = RAIZ / "resultados"

MODELO = "ibm-granite/granite-embedding-278m-multilingual"
CANDIDATOS_RERANK = 30


def topo(matriz: np.ndarray, vetor: np.ndarray, k: int) -> list[int]:
    scores = matriz @ vetor
    k = min(k, len(scores))
    melhores = np.argpartition(-scores, k - 1)[:k]
    return [int(p) for p in melhores[np.argsort(-scores[melhores])]]


def avaliar(nome: str, ordenar, consultas: list[dict], ids: list[str]) -> dict:
    posicoes: list[int | None] = []
    tempos: list[float] = []
    for consulta in consultas:
        inicio = time.perf_counter()
        ordem = ordenar(consulta)
        tempos.append((time.perf_counter() - inicio) * 1000)
        posicoes.append(avaliacao.posicao_do_alvo([ids[i] for i in ordem], consulta["trecho_id"]))
    metricas = avaliacao.metricas(posicoes)
    metricas["camada"] = nome
    metricas["p50_ms"] = avaliacao.percentil(tempos, 50)
    metricas["p95_ms"] = avaliacao.percentil(tempos, 95)
    return metricas


def avaliar_sondas(nome: str, ordenar, arquivos: list[str]) -> dict:
    acertos = 0
    tempos: list[float] = []
    erradas: list[str] = []
    for sonda in SONDAS:
        inicio = time.perf_counter()
        ordem = ordenar({"consulta": sonda["frase"]})
        tempos.append((time.perf_counter() - inicio) * 1000)
        vistos = [arquivos[i] for i in ordem[:3]]
        if any(v.startswith(pre) for v in vistos for pre in sonda["esperado"]):
            acertos += 1
        else:
            erradas.append(f"{sonda['frase'][:44]} -> {vistos[0][:30]}")
    return {
        "camada": nome,
        "acerto_em_3": round(acertos / len(SONDAS), 3),
        "acertos": acertos,
        "total": len(SONDAS),
        "p95_ms": avaliacao.percentil(tempos, 95),
        "erradas": erradas,
    }


def main() -> None:
    con = conectar()
    criar_esquema(con)
    trechos = [
        dict(linha)
        for linha in con.execute(
            "select t.id, t.obra_id, t.texto, t.idioma, t.avaliacao, o.arquivo from trecho t"
            " join obra o on o.id = t.obra_id where o.status='pronto' order by t.rowid"
        ).fetchall()
    ]
    if not trechos:
        print("acervo vazio")
        return
    textos = [t["texto"] for t in trechos]
    ids = [t["id"] for t in trechos]
    arquivos = [t["arquivo"] for t in trechos]
    avaliados = [t for t in trechos if t["avaliacao"] == 1]

    print(f"corpus {len(trechos)} trechos | modelo {MODELO}")
    print("a indexar (denso)...")
    matriz = embedder.codificar_documentos(textos, MODELO, lote=32)
    print("a indexar (BM25)...")
    lexical = hibrido.IndiceLexical(textos)

    consultas = avaliacao.gerar_consultas(avaliados, seed=42)
    vetores = embedder.codificar_consultas([c["consulta"] for c in consultas], MODELO, lote=32)
    cache = {c["consulta"]: v for c, v in zip(consultas, vetores)}

    def vetor_de(consulta: dict) -> np.ndarray:
        texto = consulta["consulta"]
        if texto not in cache:
            cache[texto] = embedder.codificar_consultas([texto], MODELO)[0]
        return cache[texto]

    def camada_a(consulta: dict) -> list[int]:
        return topo(matriz, vetor_de(consulta), 10)

    def camada_b(consulta: dict) -> list[int]:
        denso = topo(matriz, vetor_de(consulta), CANDIDATOS_RERANK)
        lex = lexical.ordenar(consulta["consulta"], CANDIDATOS_RERANK)
        return hibrido.fundir_rrf(denso, lex, k=10)

    def camada_c(consulta: dict) -> list[int]:
        denso = topo(matriz, vetor_de(consulta), CANDIDATOS_RERANK)
        lex = lexical.ordenar(consulta["consulta"], CANDIDATOS_RERANK)
        fundidos = hibrido.fundir_rrf(denso, lex, k=CANDIDATOS_RERANK)
        return hibrido.reordenar(consulta["consulta"], textos, fundidos, 10)

    camadas = [("A denso", camada_a), ("B denso+BM25", camada_b), ("C +reranker", camada_c)]

    print("\na carregar o reranker (pode demorar no primeiro uso)...")
    hibrido.carregar_reranker()

    linhas_recall = []
    linhas_sondas = []
    for nome, funcao in camadas:
        print(f"\n--- {nome} ---")
        recall = avaliar(nome, funcao, consultas, ids)
        sonda = avaliar_sondas(nome, funcao, arquivos)
        linhas_recall.append(recall)
        linhas_sondas.append(sonda)
        print(
            f"  R@1 {recall['recall_em_1']}  R@5 {recall['recall_em_5']}"
            f"  MRR@10 {recall['mrr_em_10']}  p95 {recall['p95_ms']} ms"
        )
        print(f"  sondas {sonda['acertos']}/{sonda['total']} = {sonda['acerto_em_3']}  p95 {sonda['p95_ms']} ms")

    RESULTADOS.mkdir(exist_ok=True)
    (RESULTADOS / "benchmark2.json").write_text(
        json.dumps({"recall": linhas_recall, "sondas": linhas_sondas}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\n" + "=" * 78)
    print(f"{'camada':<16} {'R@1':>6} {'R@5':>6} {'MRR':>6} {'sondas':>7} {'p95 ms':>8}")
    print("=" * 78)
    for recall, sonda in zip(linhas_recall, linhas_sondas):
        print(
            f"{recall['camada']:<16} {recall['recall_em_1']:>6} {recall['recall_em_5']:>6}"
            f" {recall['mrr_em_10']:>6} {sonda['acerto_em_3']:>7} {sonda['p95_ms']:>8}"
        )
    print("\nsondas que a camada C ainda erra:")
    for erro in linhas_sondas[-1]["erradas"]:
        print("  - " + erro)
    print(f"\nresultados: {RESULTADOS / 'benchmark2.json'}")


if __name__ == "__main__":
    main()
