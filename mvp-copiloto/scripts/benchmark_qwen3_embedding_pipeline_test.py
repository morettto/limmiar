"""Run the hybrid Qwen3+BM25 retriever over all held-out positives and negatives."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
from copiloto import busca, embedder, hibrido
from copiloto.esquema import conectar, criar_esquema

MODEL = "Qwen/Qwen3-Embedding-0.6B"
LIMIT = 200


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    eval_dir = ROOT / "data" / "avaliacao"
    cases = read(eval_dir / "teste_positivos.jsonl") + read(eval_dir / "teste_negativos.jsonl")
    con = conectar()
    criar_esquema(con)
    records = con.execute(
        "select t.id, t.obra_id, t.texto, t.embedding from trecho t"
        " join obra o on o.id=t.obra_id where o.status='pronto' and t.embedding is not null"
    ).fetchall()
    ids = [row["id"] for row in records]
    texts = [row["texto"] for row in records]
    print(f"model={MODEL}; device={os.environ.get('COPILOTO_EMBEDDER_DISPOSITIVO', 'cpu')}; chunks={len(texts)}; cases={len(cases)}; k={LIMIT}", flush=True)
    embedder.PREFIXO_CONSULTA[MODEL] = embedder.INSTRUCAO_CLINICA
    started = time.perf_counter()
    vectors = embedder.codificar_documentos(texts, MODEL, lote=16)
    print(f"encoded_documents={len(texts)}; elapsed_s={time.perf_counter() - started:.1f}", flush=True)
    busca.INDICE.ids = ids
    busca.INDICE.matriz = vectors
    busca.INDICE.obras = np.array([row["obra_id"] for row in records], dtype=object)
    busca.INDICE.modelo = MODEL
    busca.INDICE.lexical = hibrido.IndiceLexical(texts)
    embedder.carregar(MODEL)

    rows: list[dict] = []
    latencies: list[float] = []
    started_all = time.perf_counter()
    for index, case in enumerate(cases, 1):
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]])
        before = time.perf_counter()
        candidates = busca.candidatos_amplos(
            con, query, case["idioma"], limite=LIMIT, profundidade=LIMIT, por_obra=1000
        )
        elapsed_ms = (time.perf_counter() - before) * 1000
        latencies.append(elapsed_ms)
        targets = {(a["arquivo"], int(a["pagina"])) for a in case.get("alvos", [])}
        source = case.get("fonte") or {}
        exact = (source.get("arquivo"), int(source.get("pagina", 0)), int(source.get("paragrafo", 0)))
        page_ranks = [i for i, c in enumerate(candidates, 1) if (c.arquivo, c.pagina) in targets]
        exact_ranks = [i for i, c in enumerate(candidates, 1) if (c.arquivo, c.pagina, c.paragrafo) == exact]
        rows.append({
            "id": case["id"], "language": case["idioma"], "positive": bool(targets),
            "page_found_at_10": bool(page_ranks and page_ranks[0] <= 10),
            "page_found_at_20": bool(page_ranks and page_ranks[0] <= 20),
            "page_found_at_50": bool(page_ranks and page_ranks[0] <= 50),
            "page_found_at_100": bool(page_ranks and page_ranks[0] <= 100),
            "page_found_at_200": bool(page_ranks),
            "exact_paragraph_found_at_200": bool(exact_ranks),
            "first_target_rank": page_ranks[0] if page_ranks else None,
            "exact_paragraph_rank": exact_ranks[0] if exact_ranks else None,
            "latency_ms": round(elapsed_ms, 2),
            "candidates": [{"file": c.arquivo, "page": c.pagina, "paragraph": c.paragrafo, "text": c.texto}
                           for c in candidates],
        })
        if index % 25 == 0:
            print(f"{index}/{len(cases)}; elapsed_s={time.perf_counter() - started_all:.1f}", flush=True)

    out = ROOT / "resultados" / "benchmark-qwen3-embedding-0.6b-pipeline-test-top200-context.jsonl"
    out.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    positives = [row for row in rows if row["positive"]]
    negatives = [row for row in rows if not row["positive"]]
    summary = {
        "checkpoint": MODEL, "cases": len(rows), "positives": len(positives), "negatives": len(negatives),
        "latency_p50_ms": float(np.percentile(latencies, 50)),
        "latency_p95_ms": float(np.percentile(latencies, 95)),
        "elapsed_s": round(time.perf_counter() - started_all, 2), "output": str(out),
    }
    for k in (10, 20, 50, 100, 200):
        key = f"page_found_at_{k}"
        summary[key] = sum(row[key] for row in positives) / len(positives) if positives else 0
    summary["exact_paragraph_found_at_200"] = sum(r["exact_paragraph_found_at_200"] for r in positives) / len(positives) if positives else 0
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    for language in ("pt-BR", "es", "en-US"):
        subset = [r for r in positives if r["language"] == language]
        print(json.dumps({"language": language, "positive_cases": len(subset), **{
            f"page_recall_at_{k}": sum(r[f"page_found_at_{k}"] for r in subset) / len(subset) if subset else 0
            for k in (10, 50, 100, 200)
        }}, ensure_ascii=False), flush=True)
    print(json.dumps({"negative_cases_with_candidates": sum(bool(r["candidates"]) for r in negatives),
                      "negative_cases_total": len(negatives)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
