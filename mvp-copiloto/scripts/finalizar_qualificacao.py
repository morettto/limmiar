"""Fecha a qualificação independente com as adjudicações e diz se todos os alvos da régua da V1 passaram."""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import qualificacao, treinado
from avaliar import adjudicacoes, resumo

DESTINO = RAIZ / f"resultados/qualificacao-{treinado.NOME_JUIZ}"
HERDADOS = ("avaliacao_independente", "falas_avaliadas", "proveniencia_verificada", "versao", "casos_por_tipo",
            "primeira_decisao_p95_ms", "primeiro_cartao_p95_ms", "primeiro_cartao_p95_s")


def fechar(medido: dict, execucao: dict, pendentes: list) -> dict:
    relatorio = {**medido, **{k: execucao[k] for k in HERDADOS}}
    relatorio["status"] = "PASS" if not pendentes and qualificacao.atende_alvos(relatorio) else "FAIL"
    return relatorio


def main() -> int:
    protocolo = json.loads((DESTINO / "protocolo.json").read_text(encoding="utf-8"))
    registos = [json.loads(l) for l in (DESTINO / "registos.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    medido = resumo(registos, protocolo["casos"], protocolo["limiares"], adjudicacoes(f"qualificacao-{treinado.NOME_JUIZ}"))
    pendentes = medido.pop("a_adjudicar")
    relatorio = fechar(medido, json.loads((DESTINO / "resumo.json").read_text(encoding="utf-8")), pendentes)
    (DESTINO / "final.json").write_text(json.dumps(relatorio, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in relatorio.items() if k != "versao"}, ensure_ascii=False, indent=2))
    if relatorio["status"] != "PASS":
        return 1
    (RAIZ / f"data/limiares-treinado-{treinado.NOME_JUIZ}.json").write_text(json.dumps(protocolo["limiares"], indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
