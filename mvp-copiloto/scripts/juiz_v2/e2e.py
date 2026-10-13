"""Fluxo completo (portão, reescrita, busca, juiz) contra o servidor do juiz. Uso: e2e.py SAIDA.json [N_NEG]

Positivos: só falas cuja fonte está numa obra do teste fixo (o juiz não treinou nelas). Negativos: amostra de todos os tipos.
"""
from __future__ import annotations

import json
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src"), str(RAIZ / "scripts"), str(Path(__file__).parent)]
from copiloto import busca, decisao, embedder, juiz_llm
from copiloto.esquema import conectar
from avaliar import casos
from teste_fixo import obra_de_teste


def rodar(con, caso: dict) -> dict:
    inicio = time.perf_counter()
    primeiro = ultimo = None
    for d in decisao.decidir_progressivamente(con, caso["fala"], caso["contexto"], caso.get("falante", "paciente"), caso["idioma"], None,
                                              decisao.limiares(), verificar_proveniencia=lambda *a: True):
        ms = (time.perf_counter() - inicio) * 1000
        if d.cartoes and primeiro is None:
            primeiro = ms
        ultimo = d
    paginas = {(a["arquivo"], int(a["pagina"])) for a in caso.get("alvos", [])}
    cartoes = [{"arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo, "prob": c.probabilidade, "alvo": (c.arquivo, c.pagina) in paginas}
               for c in (ultimo.cartoes if ultimo else [])]
    return {"id": caso["id"], "tipo": caso["tipo"], "canal": caso.get("canal"), "cartoes": cartoes, "primeiro_ms": primeiro,
            "total_ms": (time.perf_counter() - inicio) * 1000, "motivo": ultimo.motivo_silencio if ultimo else None,
            "alerta_risco": bool(ultimo and ultimo.alerta_risco), "clarificar": bool(ultimo and ultimo.clarificar)}


def pct(valores: list[float], p: float) -> float | None:
    return sorted(valores)[min(len(valores) - 1, int(p * len(valores)))] if valores else None


def resumo(res: list[dict]) -> dict:
    pos = [r for r in res if r["tipo"] == "positivo"]
    saida = {"positivos": len(pos), "com_cartao": sum(bool(r["cartoes"]) for r in pos),
             "pagina_alvo_em_algum_cartao": sum(any(c["alvo"] for c in r["cartoes"]) for r in pos),
             "cartoes_por_caso": sum(len(r["cartoes"]) for r in pos) / max(1, len(pos)),
             "precisao_pagina_alvo": sum(c["alvo"] for r in pos for c in r["cartoes"]) / max(1, sum(len(r["cartoes"]) for r in pos)),
             "risco_alertado": sum(r["alerta_risco"] for r in pos if r["canal"] == "risco") / max(1, sum(r["canal"] == "risco" for r in pos)),
             "primeiro_cartao_ms": {"p50": pct([r["primeiro_ms"] for r in pos if r["primeiro_ms"]], .5), "p95": pct([r["primeiro_ms"] for r in pos if r["primeiro_ms"]], .95)},
             "total_ms": {"p50": pct([r["total_ms"] for r in res], .5), "p95": pct([r["total_ms"] for r in res], .95)}}
    por_tipo = defaultdict(list)
    for r in res:
        if r["tipo"] != "positivo":
            por_tipo[r["tipo"]].append(r)
    saida["negativos_com_cartao"] = {t: f"{sum(bool(r['cartoes']) for r in v)}/{len(v)}" for t, v in por_tipo.items()}
    saida["ambiguo_clarificar"] = f"{sum(r['clarificar'] for r in por_tipo.get('ambiguo', []))}/{len(por_tipo.get('ambiguo', []))}"
    return saida


def main() -> None:
    if not juiz_llm.configurado():
        raise SystemExit("Defina COPILOTO_JUIZ_URL")
    saida, n_neg = Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else 60
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    todos = casos("dev")
    pos = [c for c in todos if c["tipo"] == "positivo" and obra_de_teste((c.get("fonte") or {}).get("arquivo", ""))]
    neg = [c for c in todos if c["tipo"] != "positivo"]
    random.Random(1).shuffle(neg)
    escolhidos = pos + neg[:n_neg]
    print(f"{len(pos)} positivos de obras de teste, {len(escolhidos) - len(pos)} negativos", flush=True)
    res = []
    for i, c in enumerate(escolhidos):
        res.append(rodar(con, c))
        if i % 10 == 0:
            print(f"{i}/{len(escolhidos)}", flush=True)
    saida.write_text(json.dumps({"resumo": resumo(res), "casos": res}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumo(res), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
