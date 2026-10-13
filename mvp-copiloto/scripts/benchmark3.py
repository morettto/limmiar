"""Ronda 3: embedders da geracao atual, com a fusao final (denso na frase original, BM25 nos 3 idiomas)."""

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

from copiloto import avaliacao, embedder, hibrido, traducao  # noqa: E402
from copiloto.esquema import conectar  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
SONDAS = json.loads((RAIZ / "data" / "probes.json").read_text(encoding="utf-8"))["sondas"]
MODELOS = sys.argv[1:] or [
    "ibm-granite/granite-embedding-278m-multilingual",
    "Qwen/Qwen3-Embedding-0.6B",
    "BAAI/bge-m3",
]


def main() -> None:
    con = conectar()
    trechos = [
        dict(r)
        for r in con.execute(
            "select t.id, t.obra_id, t.texto, t.idioma, t.avaliacao, o.arquivo from trecho t"
            " join obra o on o.id = t.obra_id where o.status='pronto' order by t.rowid"
        )
    ]
    textos = [t["texto"] for t in trechos]
    ids = [t["id"] for t in trechos]
    arquivos = [t["arquivo"] for t in trechos]
    lexical = hibrido.IndiceLexical(textos)
    consultas = avaliacao.gerar_consultas([t for t in trechos if t["avaliacao"] == 1], seed=42)
    traducao.aquecer()
    variantes = {s["frase"]: traducao.variantes(s["frase"], s["idioma"]) for s in SONDAS}
    lex_consultas = {c["consulta"]: lexical.ordenar(c["consulta"], 30) for c in consultas}
    lex_sondas = {f: [lexical.ordenar(t, 30) for t in v.values()] for f, v in variantes.items()}

    linhas = []
    for modelo in MODELOS:
        print(f"\n--- {modelo} ---", flush=True)
        inicio = time.perf_counter()
        matriz = embedder.codificar_documentos(textos, modelo, lote=16)
        indexacao = time.perf_counter() - inicio

        def denso(vetor):
            s = matriz @ vetor
            top = np.argpartition(-s, 29)[:30]
            return top[np.argsort(-s[top])].tolist()

        vc = embedder.codificar_consultas([c["consulta"] for c in consultas], modelo, lote=16)
        posicoes = []
        for v, c in zip(vc, consultas):
            ordem = hibrido.fundir_rrf(denso(v), lex_consultas[c["consulta"]], k=10)
            posicoes.append(avaliacao.posicao_do_alvo([ids[i] for i in ordem], c["trecho_id"]))
        m = avaliacao.metricas(posicoes)

        acertos, so_denso, tempos, falhas = 0, 0, [], []
        for s in SONDAS:
            t0 = time.perf_counter()
            v = embedder.codificar_consultas([s["frase"]], modelo)[0]
            tempos.append((time.perf_counter() - t0) * 1000)
            d = denso(v)
            topo = [arquivos[i] for i in hibrido.fundir_rrf(d, *lex_sondas[s["frase"]], k=3)]
            if any(a.startswith(p) for a in topo for p in s["esperado"]):
                acertos += 1
            else:
                falhas.append(s["frase"][:40])
            so_denso += any(arquivos[i].startswith(p) for i in d[:3] for p in s["esperado"])

        linha = {
            "modelo": modelo,
            "recall_em_1": m["recall_em_1"],
            "recall_em_5": m["recall_em_5"],
            "mrr_em_10": m["mrr_em_10"],
            "sondas": acertos,
            "sondas_so_denso": so_denso,
            "embed_p50_ms": avaliacao.percentil(tempos, 50),
            "embed_p95_ms": avaliacao.percentil(tempos, 95),
            "indexacao_s": round(indexacao, 1),
            "falhas": falhas,
        }
        linhas.append(linha)
        print(json.dumps(linha, ensure_ascii=False), flush=True)

    (RAIZ / "resultados" / "benchmark3.json").write_text(json.dumps(linhas, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nmodelo                                       R@1    R@5    MRR   sondas denso-so  p50  p95  idx s")
    for l in linhas:
        print(
            f"{l['modelo'].split('/')[-1][:42]:<42} {l['recall_em_1']:>6} {l['recall_em_5']:>6} {l['mrr_em_10']:>6}"
            f"   {l['sondas']:>2}/12  {l['sondas_so_denso']:>2}/12  {l['embed_p50_ms']:>5} {l['embed_p95_ms']:>5} {l['indexacao_s']:>6}"
        )


if __name__ == "__main__":
    main()
