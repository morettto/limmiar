"""Compara cortes mais restritivos sobre referências verificadas de uma execução nova."""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import avaliacao


if __name__ == "__main__":
    pasta = Path(sys.argv[1])
    casos = [json.loads(l) for l in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if l.strip()]
    regs = [json.loads(l) for l in (pasta / "registos.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    revisoes = [json.loads(l) for l in Path(sys.argv[3]).read_text(encoding="utf-8").splitlines() if l.strip()]
    for limite in (.75, .8, .85, .9, .95, .98):
        filtrados = [{**r, "decisao": {**r["decisao"], "cartoes": [c for c in r["decisao"]["cartoes"]
                     if c["probabilidade"] >= limite]}} for r in regs]
        metricas = avaliacao.avaliar_referencias(casos, filtrados, revisoes)
        metricas.pop("pending_review")
        print(json.dumps({"limiar": limite, **metricas}, ensure_ascii=False))
