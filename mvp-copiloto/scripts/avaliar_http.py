"""Avaliação nova do serviço real, sem reaproveitar respostas de outra versão."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from copiloto import avaliacao
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def request(url: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request(url, data=data, headers={"Content-Type": "application/json"}), timeout=120) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", default="final100_verificado")
    parser.add_argument("--url", default="http://127.0.0.1:8001")
    parser.add_argument("--adjudicacoes", type=Path)
    args = parser.parse_args()
    source = ROOT / "data/avaliacao" / f"{args.corpus}.jsonl"
    cases = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
    health = request(f"{args.url}/api/saude")
    assert health.get("contrato") == "multiplas-fontes-v1", "Contrato desatualizado: reinicie o serviço"
    metadata = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted((ROOT / "src/copiloto").glob("*.py"))}
    assert health.get("source_hashes") == metadata, "Reinicie o serviço: o código carregado difere do código avaliado"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = ROOT / "resultados" / f"http-{args.corpus}-{stamp}"
    output.mkdir()
    rows = []
    with (output / "registos.jsonl").open("w", encoding="utf-8") as stream:
        for case in cases:
            started = time.perf_counter()
            decision = request(f"{args.url}/api/consultar", {
                "frase": case["fala"], "contexto": case.get("contexto", []),
                "falante": case.get("falante", "paciente"), "idioma": case["idioma"],
            })
            cards = decision["cartoes"]
            row = {"id": case["id"], "positivo": bool(case.get("esperados")),
                   "known_anchors": [c["trecho_id"] for c in cards if c["trecho_id"] in case.get("esperados", [])],
                   "ms": round((time.perf_counter() - started) * 1000), "decisao": decision}
            rows.append(row)
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
            print(f"{len(rows)}/{len(cases)} {case['id']}: {len(cards)} referências, {len(row['known_anchors'])} âncoras conhecidas", flush=True)
    assert request(f"{args.url}/api/saude") == health, "Configuração mudou durante a avaliação"
    assert metadata == {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in sorted((ROOT / "src/copiloto").glob("*.py"))}, "Código mudou durante a avaliação"
    reviews = [] if args.adjudicacoes is None else [json.loads(line) for line in args.adjudicacoes.read_text(encoding="utf-8").splitlines() if line.strip()]
    metrics = avaliacao.avaliar_referencias(cases, rows, reviews)
    pending = metrics.pop("pending_review")
    (output / "adjudicar.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in pending), encoding="utf-8")
    report = {"created_at": stamp, "health": health, "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "source_hashes": metadata, "cases": len(rows), **metrics,
              "adjudications_sha256": hashlib.sha256(args.adjudicacoes.read_bytes()).hexdigest() if args.adjudicacoes else None,
              "p95_ms": sorted(r["ms"] for r in rows)[int(.95 * (len(rows) - 1))],
              "clinical_validation": "Âncoras alternativas requerem adjudicação profissional; este relatório não certifica o modelo."}
    (output / "resumo.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
