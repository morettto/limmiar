"""Compara embedders sobre o acervo real, com o cenario do Limmiar.

Mede, por modelo:
  - Recall@1, Recall@5, MRR@10 mono-idioma (perguntas geradas por inverse cloze)
  - acerto nas sondas cross-lingual escritas a mao
  - latencia de uma frase (p50/p95), que e o caminho critico da sessao
  - latencia da busca sem filtro, com 50% do acervo e com 2 obras
  - bytes por trecho no indice

Nao usa LLM. As perguntas saem do proprio texto dos PDFs.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import logging  # noqa: E402

logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import avaliacao, embedder  # noqa: E402
from copiloto.esquema import DIR_PDFS, conectar, criar_esquema  # noqa: E402

MODELOS_PADRAO = [
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "intfloat/multilingual-e5-small",
    "intfloat/multilingual-e5-base",
    "ibm-granite/granite-embedding-278m-multilingual",
]

SONDAS = json.loads((Path(__file__).resolve().parents[1] / "data" / "probes.json").read_text(encoding="utf-8"))
RESULTADOS = Path(__file__).resolve().parents[1] / "resultados"
REPETICOES_LATENCIA = 30


def carregar_corpus(con) -> tuple[list[dict], list[dict]]:
    trechos = [
        dict(linha)
        for linha in con.execute(
            "select t.id, t.obra_id, t.texto, t.idioma, t.avaliacao, o.arquivo"
            " from trecho t join obra o on o.id = t.obra_id"
            " where o.status = 'pronto' order by t.rowid"
        ).fetchall()
    ]
    avaliados = [t for t in trechos if t["avaliacao"] == 1]
    return trechos, avaliados


def topo(matriz: np.ndarray, vetor: np.ndarray, k: int) -> np.ndarray:
    scores = matriz @ vetor
    k = min(k, len(scores))
    melhores = np.argpartition(-scores, k - 1)[:k]
    return melhores[np.argsort(-scores[melhores])]


def medir_latencia(modelo: str, frases: list[str]) -> tuple[float, float]:
    embedder.codificar_consultas([frases[0]], modelo)
    tempos: list[float] = []
    for i in range(REPETICOES_LATENCIA):
        frase = frases[i % len(frases)]
        inicio = time.perf_counter()
        embedder.codificar_consultas([frase], modelo)
        tempos.append((time.perf_counter() - inicio) * 1000)
    return avaliacao.percentil(tempos, 50), avaliacao.percentil(tempos, 95)


def medir_busca(matriz: np.ndarray, vetores: np.ndarray, mascara: np.ndarray | None) -> float:
    alvo = matriz if mascara is None else matriz[mascara]
    tempos: list[float] = []
    for vetor in vetores[:REPETICOES_LATENCIA]:
        inicio = time.perf_counter()
        topo(alvo, vetor, 5)
        tempos.append((time.perf_counter() - inicio) * 1000)
    return avaliacao.percentil(tempos, 95)


def avaliar_modelo(modelo: str, trechos: list[dict], avaliados: list[dict]) -> dict:
    print(f"\n--- {modelo} ---")
    inicio = time.perf_counter()
    matriz = embedder.codificar_documentos([t["texto"] for t in trechos], modelo, lote=32)
    indexacao = time.perf_counter() - inicio
    ids = [t["id"] for t in trechos]
    arquivos = [t["arquivo"] for t in trechos]
    obras = np.array([t["obra_id"] for t in trechos], dtype=object)
    print(f"  indexou {len(trechos)} trechos em {indexacao:.1f}s ({matriz.shape[1]} dims)")

    consultas = avaliacao.gerar_consultas(avaliados, seed=42)
    vetores = embedder.codificar_consultas([c["consulta"] for c in consultas], modelo, lote=32)
    posicoes: list[int | None] = []
    for vetor, consulta in zip(vetores, consultas):
        ordem = topo(matriz, vetor, 10)
        encontrados = [ids[int(p)] for p in ordem]
        posicoes.append(avaliacao.posicao_do_alvo(encontrados, consulta["trecho_id"]))
    metricas = avaliacao.metricas(posicoes)

    sondas = SONDAS["sondas"]
    vetores_sonda = embedder.codificar_consultas([s["frase"] for s in sondas], modelo)
    acertos_em_3 = 0
    detalhe_sondas = []
    for sonda, vetor in zip(sondas, vetores_sonda):
        ordem = topo(matriz, vetor, 3)
        vistos = [arquivos[int(p)] for p in ordem]
        acertou = any(v.startswith(pre) for v in vistos for pre in sonda["esperado"])
        acertos_em_3 += int(acertou)
        detalhe_sondas.append(
            {"frase": sonda["frase"][:48], "acertou": acertou, "top1": vistos[0][:36]}
        )

    p50, p95 = medir_latencia(modelo, [s["frase"] for s in sondas])
    obras_unicas = list(dict.fromkeys(obras.tolist()))
    metade = np.isin(obras, np.array(obras_unicas[: len(obras_unicas) // 2], dtype=object))
    duas = np.isin(obras, np.array(obras_unicas[:2], dtype=object))

    resultado = {
        "modelo": modelo,
        "dimensoes": int(matriz.shape[1]),
        "trechos": len(trechos),
        "segundos_indexacao": round(indexacao, 1),
        "bytes_por_trecho": int(matriz.shape[1] * 4),
        "recall_em_1": metricas.get("recall_em_1"),
        "recall_em_5": metricas.get("recall_em_5"),
        "mrr_em_10": metricas.get("mrr_em_10"),
        "perguntas": metricas.get("consultas"),
        "sondas_acerto_em_3": round(acertos_em_3 / len(sondas), 3),
        "sondas_total": len(sondas),
        "embed_p50_ms": p50,
        "embed_p95_ms": p95,
        "busca_p95_ms_sem_filtro": medir_busca(matriz, vetores_sonda, None),
        "busca_p95_ms_metade": medir_busca(matriz, vetores_sonda, metade),
        "busca_p95_ms_duas_obras": medir_busca(matriz, vetores_sonda, duas),
        "detalhe_sondas": detalhe_sondas,
    }
    print(
        f"  Recall@1 {resultado['recall_em_1']}  Recall@5 {resultado['recall_em_5']}"
        f"  MRR@10 {resultado['mrr_em_10']}  ({resultado['perguntas']} perguntas)"
    )
    print(
        f"  sondas cross-lingual: {acertos_em_3}/{len(sondas)}"
        f"   embed p50 {p50} ms / p95 {p95} ms"
    )
    return resultado


def main(modelos: list[str]) -> None:
    con = conectar()
    criar_esquema(con)
    trechos, avaliados = carregar_corpus(con)
    if not trechos:
        print("acervo vazio; corra scripts/ingerir.py primeiro")
        return
    idiomas = con.execute(
        "select idioma, count(*) as n from obra where status='pronto' group by idioma"
    ).fetchall()
    print(f"corpus: {len(trechos)} trechos, {len(avaliados)} retidos para avaliacao")
    print("obras por idioma: " + ", ".join(f"{linha['idioma']}={linha['n']}" for linha in idiomas))

    linhas = [avaliar_modelo(m, trechos, avaliados) for m in modelos]

    RESULTADOS.mkdir(exist_ok=True)
    destino = RESULTADOS / "benchmark.json"
    destino.write_text(json.dumps(linhas, ensure_ascii=False, indent=2), encoding="utf-8")

    cabecalho = (
        f"{'modelo':<52} {'dim':>4} {'R@1':>5} {'R@5':>5} {'MRR':>5}"
        f" {'sonda':>6} {'p50ms':>6} {'p95ms':>6} {'idx s':>6}"
    )
    print("\n" + "=" * len(cabecalho))
    print(cabecalho)
    print("=" * len(cabecalho))
    for linha in sorted(linhas, key=lambda r: -(r["sondas_acerto_em_3"] + r["recall_em_5"])):
        print(
            f"{linha['modelo'].split('/')[-1][:52]:<52} {linha['dimensoes']:>4}"
            f" {linha['recall_em_1']:>5} {linha['recall_em_5']:>5} {linha['mrr_em_10']:>5}"
            f" {linha['sondas_acerto_em_3']:>6} {linha['embed_p50_ms']:>6} {linha['embed_p95_ms']:>6}"
            f" {linha['segundos_indexacao']:>6}"
        )
    print("\nlatencia da busca (numpy, forca bruta, p95 ms):")
    for linha in linhas:
        print(
            f"  {linha['modelo'].split('/')[-1][:44]:<44}"
            f" sem filtro {linha['busca_p95_ms_sem_filtro']:>6}"
            f" | metade {linha['busca_p95_ms_metade']:>6}"
            f" | 2 obras {linha['busca_p95_ms_duas_obras']:>6}"
        )
    print(f"\nresultados: {destino}")


if __name__ == "__main__":
    main(sys.argv[1:] or MODELOS_PADRAO)
