"""Compare judges on a fixed fresh set; calibrate and select exclusively on dev."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

os.environ["COPILOTO_EMBEDDER_DISPOSITIVO"] = "cpu"
os.environ["COPILOTO_JUIZ_DISPOSITIVO"] = "cpu"
os.environ.setdefault("OMP_NUM_THREADS", "6")
os.environ.setdefault("MKL_NUM_THREADS", "6")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np
from sklearn.linear_model import LogisticRegression
from copiloto import embedder, hibrido, treinado

MODEL = "BAAI/bge-m3"
POOL = 20
RESULTS = ROOT / "resultados/final100-cpu"


def read(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write(path: Path, records: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in records), encoding="utf-8")


def features(query: np.ndarray, documents: np.ndarray) -> np.ndarray:
    return np.concatenate((documents * query, np.abs(documents - query), (documents @ query)[:, None]), axis=1)


def metrics(rows: list[dict], threshold: float) -> dict:
    positive = [r for r in rows if r["positive"]]
    emitted = [r for r in rows if r["score"] >= threshold]
    correct = sum(r["correct"] for r in emitted)
    return {
        "cases": len(rows), "positive_cases": len(positive), "emitted": len(emitted),
        "correct_emitted": correct, "precision": correct / len(emitted) if emitted else 0,
        "coverage_positive": correct / len(positive) if positive else 0,
        "negative_false_positive": sum(not r["positive"] for r in emitted),
        "top1_exact_anchor": sum(r["correct"] for r in positive) / len(positive) if positive else 0,
        "candidate_recall": sum(r["available"] for r in positive) / len(positive) if positive else 0,
        "score_p50_ms": float(np.percentile([r["judge_ms"] for r in rows], 50)),
        "score_p95_ms": float(np.percentile([r["judge_ms"] for r in rows], 95)),
    }


def calibrate(rows: list[dict]) -> tuple[float, dict]:
    options = []
    for threshold in sorted({r["score"] for r in rows}) + [1.000001]:
        measurement = metrics(rows, threshold)
        options.append((threshold, measurement))
    safe = [(threshold, m) for threshold, m in options if m["precision"] >= 0.9 and m["coverage_positive"] >= 0.1]
    if safe:
        threshold, measurement = max(safe, key=lambda x: (x[1]["coverage_positive"], x[1]["precision"]))
        return threshold, {**measurement, "dev_gate": True}
    # No qualified threshold: suppress evidence instead of presenting an unsafe confidence score.
    return 1.000001, {**metrics(rows, 1.000001), "dev_gate": False,
                      "best_top1": metrics(rows, 0)["top1_exact_anchor"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--neural", action="store_true")
    args = parser.parse_args()
    RESULTS.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(f"file:{ROOT / 'data/acervo.db'}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    docs = [dict(r) for r in connection.execute(
        "select t.id,t.texto,t.embedding,o.arquivo,t.pagina,t.paragrafo from trecho t "
        "join obra o on o.id=t.obra_id where o.status='pronto' and embedding is not null order by t.id")]
    vectors = np.stack([np.frombuffer(d.pop("embedding"), dtype=np.float32) for d in docs])
    assert vectors.shape[1] == 1024
    ids = {d["id"]: i for i, d in enumerate(docs)}
    source_index = {(d["arquivo"], d["pagina"], d["paragrafo"]): d["id"] for d in docs}
    all_dev = read(ROOT / "data/avaliacao/dev_positivos.jsonl") + read(ROOT / "data/avaliacao/dev_negativos.jsonl")
    rng = np.random.default_rng(20260930)
    train = []
    for language in ("pt-BR", "es", "en-US"):
        for positive in (True, False):
            subset = [c for c in all_dev if c["idioma"] == language and bool(c.get("alvos")) == positive]
            rng.shuffle(subset)
            train.extend(subset[:35 if positive else 65])
    for c in train:
        src = c.get("fonte") or {}
        anchor = source_index.get((src.get("arquivo"), src.get("pagina"), src.get("paragrafo")))
        c["esperados"] = [anchor] if anchor else []
    dev = read(ROOT / "data/avaliacao/produto_prova.jsonl")
    final = read(ROOT / "data/avaliacao/final100_verificado.jsonl")
    assert not {c["fala"] for c in train + dev}.intersection(c["fala"] for c in final)
    cases = train + dev + final
    embedding_path = RESULTS / "query_vectors.npy"
    statements = [" ".join(c.get("contexto", [])[-5:] + [c["fala"]]) for c in cases]
    statement_hash = hashlib.sha256(json.dumps(statements, ensure_ascii=False).encode()).hexdigest()
    hash_path = RESULTS / "query_hash.txt"
    started = time.perf_counter()
    if embedding_path.exists() and hash_path.read_text() == statement_hash:
        queries = np.load(embedding_path)
    else:
        import torch
        torch.set_num_threads(6)
        model = embedder.carregar(MODEL)
        model.max_seq_length = 256
        queries = embedder.codificar_consultas(statements, MODEL, lote=8)
        np.save(embedding_path, queries)
        hash_path.write_text(statement_hash)
    embedding_elapsed = time.perf_counter() - started
    print(f"queries={len(cases)}; embedding_elapsed_s={embedding_elapsed:.1f}; docs={len(docs)}", flush=True)
    lexical = hibrido.IndiceLexical([d["texto"] for d in docs])
    pools, dense_scores, lexical_ranks = [], [], []
    for case, query in zip(cases, queries):
        dense = vectors @ query
        dense_order = np.argsort(-dense, kind="stable")[:200].tolist()
        lexical_order = lexical.ordenar(case["fala"], 200)
        fused = hibrido.fundir_rrf(dense_order, lexical_order, k=POOL)
        pools.append(fused)
        dense_scores.append(dense)
        lexical_ranks.append({index: rank for rank, index in enumerate(lexical_order, 1)})
    x_train, y_train = [], []
    for i, case in enumerate(train):
        pool = list(dict.fromkeys(pools[i] + [ids[target] for target in case["esperados"] if target in ids]))
        x_train.append(features(queries[i], vectors[pool]))
        y_train.extend(int(docs[index]["id"] in case["esperados"]) for index in pool)
    x_train = np.vstack(x_train)
    classifier = LogisticRegression(C=0.2, class_weight="balanced", max_iter=200, random_state=20260930)
    classifier.fit(x_train, y_train)
    model_path = ROOT / "modelos/juiz-local/logistica-pares-cpu.npz"
    np.savez(model_path, W=classifier.coef_[0], b=classifier.intercept_[0], modelo=MODEL,
             features="product,absolute_difference,cosine")
    names = ["dense", "rrf", "logistica-pares-cpu"]
    if args.neural:
        names.append("gte-r2")
    dev_start = len(train)
    outputs: dict[str, dict[str, list[dict]]] = {name: {"dev": [], "final": []} for name in names}
    for i in range(dev_start, len(cases)):
        case, query, pool = cases[i], queries[i], pools[i]
        part = "dev" if i < dev_start + len(dev) else "final"
        expected = set(case["esperados"])
        available = bool(expected.intersection(docs[index]["id"] for index in pool))
        for name in names:
            before = time.perf_counter()
            if name == "dense":
                scores = dense_scores[i][pool]
            elif name == "rrf":
                scores = np.asarray([1 / (60 + rank) for rank in range(1, len(pool) + 1)])
            elif name == "logistica-pares-cpu":
                scores = classifier.predict_proba(features(query, vectors[pool]))[:, 1]
            else:
                cache_path = RESULTS / f"gte-{case['id']}.json"
                if cache_path.exists():
                    cached = json.loads(cache_path.read_text())
                    scores = np.asarray(cached["scores"])
                    before = time.perf_counter() - cached["ms"] / 1000
                else:
                    scores = []
                    for offset in range(0, len(pool), 4):
                        scores.extend(treinado.julgar(case["fala"], case.get("contexto", []),
                                      [docs[index]["texto"] for index in pool[offset:offset + 4]]))
                    cache_path.write_text(json.dumps({"scores": scores, "ms": (time.perf_counter()-before)*1000}))
                    scores = np.asarray(scores)
            judge_ms = (time.perf_counter() - before) * 1000
            best = int(np.argmax(scores))
            selected = docs[pool[best]]
            row = {"id": case["id"], "language": case["idioma"], "family": case.get("fenomeno", case["id"]),
                   "positive": bool(expected), "available": available, "correct": selected["id"] in expected,
                   "selected": {k: selected[k] for k in ("id", "arquivo", "pagina", "paragrafo")},
                   "score": float(scores[best]), "judge_ms": judge_ms,
                   "pool": [docs[index]["id"] for index in pool], "scores": scores.tolist()}
            outputs[name][part].append(row)
        if (i - dev_start + 1) % 10 == 0:
            print(f"scored={i-dev_start+1}/{len(dev)+len(final)}", flush=True)
        for name in names:
            write(RESULTS / f"{name}-{part}.jsonl", outputs[name][part])
    calibration = {name: calibrate(outputs[name]["dev"]) for name in names}
    selected_name = max(names, key=lambda name: (
        calibration[name][1]["dev_gate"], calibration[name][1]["coverage_positive"],
        calibration[name][1].get("best_top1", calibration[name][1]["top1_exact_anchor"]),
        -calibration[name][1]["score_p95_ms"]))
    summary = {"device": "cpu", "gpu_vram_bytes": 0, "training_cases": len(train),
               "dev_cases": len(dev), "final_cases": len(final), "positive_families": 20,
               "pool": POOL, "corpus_chunks": len(docs), "embedding_elapsed_s": embedding_elapsed,
               "selected_by_dev": selected_name, "models": {}}
    for name in names:
        threshold, dev_measurement = calibration[name]
        final_rows = outputs[name]["final"]
        family_rows = {}
        for row in final_rows:
            if row["positive"]:
                family_rows.setdefault(row["family"], []).append(row)
        family_values = np.asarray([np.mean([r["correct"] for r in rows]) for rows in family_rows.values()])
        samples = rng.choice(family_values, (5000, len(family_values)), replace=True).mean(axis=1)
        summary["models"][name] = {
            "threshold": threshold, "dev": dev_measurement, "final": metrics(final_rows, threshold),
            "top1_family_bootstrap_95ci": np.percentile(samples, [2.5, 97.5]).tolist(),
            "final_by_language": {language: metrics([r for r in final_rows if r["language"] == language], threshold)
                                  for language in ("pt-BR", "es", "en-US")}}
    threshold = calibration[selected_name][0]
    manifest = {"version": 1, "judge": selected_name, "embedding_model": MODEL,
                "threshold": threshold, "dev_gate_passed": calibration[selected_name][1]["dev_gate"],
                "production_validated": False, "training_device": "cpu", "pair_model": str(model_path.relative_to(ROOT)),
                "pool_size": POOL, "query_max_tokens": 256,
                "decision": "abstain unless calibrated threshold passed; clinical match requires professional review",
                "missing_sources": [], "final_sha256": hashlib.sha256((ROOT / 'data/avaliacao/final100_verificado.jsonl').read_bytes()).hexdigest()}
    (RESULTS / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "modelos/juiz-local/manifest-final100.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
