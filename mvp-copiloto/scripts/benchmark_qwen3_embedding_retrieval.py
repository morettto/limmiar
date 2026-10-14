"""Controlled dense-model swap against the same 200 held-out retrieval cases."""

from __future__ import annotations

import json
import os
import sys
import time
import argparse
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
from copiloto import busca, embedder, hibrido
from copiloto.esquema import conectar, criar_esquema

DEFAULT_MODEL = "Qwen/Qwen3-Embedding-0.6B"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--include-context", action="store_true")
    args = parser.parse_args()
    model_name = args.model
    if model_name == "lightonai/mDenseOn":
        embedder.PREFIXO_CONSULTA[model_name] = "query: "
        embedder.PREFIXO_DOCUMENTO[model_name] = "document: "
    elif model_name == "Qwen/Qwen3-Embedding-0.6B":
        embedder.PREFIXO_CONSULTA[model_name] = embedder.INSTRUCAO_CLINICA
    cases = read(ROOT / "data" / "avaliacao" / "benchmark_200.jsonl")
    con = conectar()
    criar_esquema(con)
    records = con.execute(
        "select t.id, t.obra_id, t.texto, t.embedding from trecho t"
        " join obra o on o.id=t.obra_id where o.status='pronto' and t.embedding is not null"
    ).fetchall()
    ids = [row["id"] for row in records]
    texts = [row["texto"] for row in records]
    print(f"model={model_name}; device={os.environ.get('COPILOTO_EMBEDDER_DISPOSITIVO', 'cpu')}; corpus_chunks={len(texts)}; cases={len(cases)}", flush=True)
    started = time.perf_counter()
    doc_vectors = embedder.codificar_documentos(texts, model_name, lote=16)
    print(f"encoded_documents={len(texts)}; elapsed={time.perf_counter() - started:.1f}s", flush=True)
    busca.INDICE.ids = ids
    busca.INDICE.matriz = doc_vectors
    busca.INDICE.obras = np.array([row["obra_id"] for row in records], dtype=object)
    busca.INDICE.modelo = model_name
    busca.INDICE.lexical = hibrido.IndiceLexical(texts)
    embedder.carregar(model_name)

    context_suffix = "-context" if args.include_context else ""
    output = ROOT / "resultados" / f"benchmark-{model_name.replace('/', '-').lower()}-retrieval-200{context_suffix}.jsonl"
    rows = []
    latencies = []
    started_all = time.perf_counter()
    for index, case in enumerate(cases, 1):
        before = time.perf_counter()
        query = " ".join(case.get("contexto", [])[-5:] + [case["fala"]]) if args.include_context else case["fala"]
        candidates = busca.candidatos_amplos(
            con,
            query,
            case["idioma"],
            limite=200,
            profundidade=200,
            por_obra=1000,
        )
        elapsed = (time.perf_counter() - before) * 1000
        latencies.append(elapsed)
        targets = {(item["arquivo"], int(item["pagina"])) for item in case.get("alvos", [])}
        exact = case.get("fonte") or {}
        target_paragraph = (exact.get("arquivo"), int(exact.get("pagina", 0)), int(exact.get("paragrafo", 0)))
        page_ranks = [
            rank for rank, candidate in enumerate(candidates, 1)
            if (candidate.arquivo, candidate.pagina) in targets
        ]
        paragraph_ranks = [
            rank for rank, candidate in enumerate(candidates, 1)
            if (candidate.arquivo, candidate.pagina, candidate.paragrafo) == target_paragraph
        ]
        rows.append({
            "id": case["id"],
            "language": case["idioma"],
            "used_context": args.include_context,
            "page_found_at_1": bool(page_ranks and page_ranks[0] <= 1),
            "page_found_at_5": bool(page_ranks and page_ranks[0] <= 5),
            "page_found_at_10": bool(page_ranks and page_ranks[0] <= 10),
            "page_found_at_20": bool(page_ranks and page_ranks[0] <= 20),
            "page_found_at_50": bool(page_ranks and page_ranks[0] <= 50),
            "page_found_at_100": bool(page_ranks and page_ranks[0] <= 100),
            "page_found_at_200": bool(page_ranks),
            "exact_paragraph_found_at_200": bool(paragraph_ranks),
            "first_target_page_rank": page_ranks[0] if page_ranks else None,
            "exact_paragraph_rank": paragraph_ranks[0] if paragraph_ranks else None,
            "latency_ms": round(elapsed, 2),
            "candidates": [{
                "file": candidate.arquivo,
                "page": candidate.pagina,
                "paragraph": candidate.paragrafo,
                "text": candidate.texto,
            } for candidate in candidates],
        })
        if index % 10 == 0:
            print(f"{index}/{len(cases)}; elapsed={time.perf_counter() - started_all:.1f}s", flush=True)

    output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    summary = {"checkpoint": model_name, "cases": len(rows), "corpus_chunks": len(texts), "used_context": args.include_context}
    for metric in ("page_found_at_1", "page_found_at_5", "page_found_at_10", "page_found_at_20", "page_found_at_50", "page_found_at_100", "page_found_at_200", "exact_paragraph_found_at_200"):
        summary[metric] = sum(row[metric] for row in rows) / len(rows) if rows else 0
    summary["latency_p50_ms"] = float(np.percentile(latencies, 50)) if latencies else 0
    summary["latency_p95_ms"] = float(np.percentile(latencies, 95)) if latencies else 0
    summary["elapsed_s"] = round(time.perf_counter() - started_all, 2)
    summary["output"] = str(output)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    for language in ("pt-BR", "es", "en-US"):
        subset = [row for row in rows if row["language"] == language]
        print(json.dumps({"language": language, "cases": len(subset), **{
            metric: sum(row[metric] for row in subset) / len(subset) if subset else 0
            for metric in ("page_found_at_10", "page_found_at_50", "page_found_at_200", "exact_paragraph_found_at_200")
        }}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
