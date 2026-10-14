"""Benchmarka o Jina reranker v3.5 no conjunto reconstruído do Limmiar.

O conjunto é montado por chave, não por posição de linha: 250 positivos com
trecho-fonte e as adjudicações que conseguem ser ligadas a um candidato em
dev_pares.jsonl. Isso evita o desalinhamento encontrado no benchmark antigo.
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

import torch
from transformers import AutoModel

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "modelos" / "hf" / "jina-reranker-v3.5"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def wilson(certos: int, total: int, z: float = 1.96) -> float:
    if total == 0:
        return 0.0
    p = certos / total
    den = 1 + z * z / total
    centre = p + z * z / (2 * total)
    spread = z * ((p * (1 - p) + z * z / (4 * total)) / total) ** 0.5
    return (centre - spread) / den


def dataset() -> list[dict]:
    fonte = {
        (item["arquivo"], int(item["pagina"]), int(item["paragrafo"])): item["texto"]
        for item in load_jsonl(ROOT / "data" / "trechos_fonte.jsonl")
    }
    saida: list[dict] = []
    for item in load_jsonl(ROOT / "data" / "avaliacao" / "dev_positivos.jsonl"):
        f = item["fonte"]
        trecho = fonte.get((f["arquivo"], int(f["pagina"]), int(f["paragrafo"])))
        if trecho:
            saida.append({"id": item["id"] + ":fonte", "fala": item["fala"], "contexto": item.get("contexto", []), "trecho": trecho, "valido": True, "origem": "fonte"})

    candidatos = {
        (item["id"], item["arquivo"], int(item["pagina"])): item
        for item in load_jsonl(ROOT / "data" / "avaliacao" / "dev_pares.jsonl")
    }
    for item in load_jsonl(ROOT / "data" / "avaliacao" / "dev_adjudicacoes.jsonl"):
        candidato = candidatos.get((item["id"], item["arquivo"], int(item["pagina"])))
        if candidato:
            saida.append({"id": item["id"] + ":adjudicacao", "fala": candidato["fala"], "contexto": candidato.get("contexto", []), "trecho": candidato["trecho"], "valido": bool(item["valido"]), "origem": "adjudicacao"})
    return saida


def query(item: dict) -> str:
    contexto = " ".join(item["contexto"][-5:])
    return f"Contexto anterior: {contexto}\nFala do paciente: {item['fala']}" if contexto else f"Fala do paciente: {item['fala']}"


def main() -> None:
    items = dataset()
    print(f"pares={len(items)} validos={sum(x['valido'] for x in items)} adjudicacoes={sum(x['origem'] == 'adjudicacao' for x in items)}", flush=True)
    model = AutoModel.from_pretrained(MODEL, dtype="auto", trust_remote_code=True)
    model.eval()
    if torch.cuda.is_available():
        model.cuda()

    results: list[dict] = []
    for index, item in enumerate(items, 1):
        start = time.perf_counter()
        ranked = model.rerank(query(item), [item["trecho"]])
        score = float(ranked[0]["relevance_score"])
        results.append({"id": item["id"], "valido": item["valido"], "origem": item["origem"], "score": score, "ms": (time.perf_counter() - start) * 1000})
        if index % 25 == 0:
            print(f"{index}/{len(items)}", flush=True)

    destination = ROOT / "resultados" / "benchmark-jina35-reconstruido.jsonl"
    destination.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in results), encoding="utf-8")
    latencies = sorted(item["ms"] for item in results)
    valid_total = sum(item["valido"] for item in results)
    print(f"latencia_p50_ms={latencies[len(latencies)//2]:.1f} latencia_p95_ms={latencies[int(len(latencies)*.95)]:.1f}")
    for threshold in (0.5, 0.6, 0.7, 0.8, 0.9):
        accepted = [item for item in results if item["score"] >= threshold]
        correct = sum(item["valido"] for item in accepted)
        print(json.dumps({"threshold": threshold, "accepted": len(accepted), "precision": correct / len(accepted) if accepted else 0, "wilson95": wilson(correct, len(accepted)), "recall": correct / valid_total if valid_total else 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
