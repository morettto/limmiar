"""Portão de qualidade do decisor ativo (Jev ou local), medido no corpus de teste que a afinação nunca viu.

  COPILOTO_CORPUS=teste python scripts/portao_qualidade.py

Lê resultados/avaliacao-teste-pipeline-<decisor>.json (gerado por avaliar.py relatorio) e sai com código 1
se algum alvo do contrato S19 não for cumprido.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from copiloto import decisao, metadados  # noqa: E402
from copiloto.qualificacao import ALVOS, valor  # noqa: E402


def main() -> int:
    arquivo = RAIZ / "resultados" / f"avaliacao-teste-pipeline-{decisao.decisor()}.json"
    if not arquivo.exists():
        print(f"sem avaliação do decisor {decisao.decisor()} no corpus de teste: {arquivo.name}")
        return 1
    r = json.loads(arquivo.read_text(encoding="utf-8"))
    if r.get("versao") != metadados.versao_pesquisa() or r.get("limiares") != decisao.limiares():
        print("Avaliação desatualizada ou de outra configuração: gere nova avaliação multirreferência.")
        return 1
    print(f"decisor {decisao.decisor()} · {r['cartoes_mostrados']} cartões · precisão {r['precisao']} · limiares {r['limiares']}")
    falhou = 0
    for nome, chave, sinal, alvo in ALVOS:
        v = valor(r, chave)
        ok = v is not None and (v >= alvo if sinal == ">=" else v <= alvo)
        falhou += not ok
        print(f"  [{'ok  ' if ok else 'FALHA'}] {nome}: {v} (alvo {sinal} {alvo})")
    print(f"  cobertura geral {r['cobertura_geral']} · cobertura de risco com cartão {r['cobertura_risco_com_cartao']} · latência p95 {r['latencia_p95_ms'].get('total')} ms")
    return 1 if falhou else 0


if __name__ == "__main__":
    raise SystemExit(main())
