"""Fluxo completo sobre as falas sintéticas, contra o acervo de teste.
Uso: COPILOTO_CORPUS=teste COPILOTO_JUIZ_URL=... qualificar5k.py FRASES.jsonl SAIDA.jsonl [THREADS]
Retoma de onde parou. `qualificar5k.py --resumo SAIDA.jsonl` só imprime o resumo.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src")]
from copiloto import busca, decisao, embedder, juiz_llm
from copiloto.esquema import conectar


def rodar(con, f: dict) -> dict:
    inicio = time.perf_counter()
    primeiro = ultimo = None
    for d in decisao.decidir_progressivamente(con, f["fala"], f["contexto"], f["falante"], f["idioma"], None, decisao.limiares(),
                                              verificar_proveniencia=lambda *a: True):
        if d.cartoes and primeiro is None:
            primeiro = (time.perf_counter() - inicio) * 1000
        ultimo = d
    fonte = f.get("fonte") or {}
    chave = (fonte.get("arquivo"), fonte.get("pagina"), fonte.get("paragrafo"))
    cartoes = [{"trecho_id": c.trecho_id, "arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo, "prob": c.probabilidade, "texto": c.texto,
                "fonte_exata": (c.arquivo, c.pagina, c.paragrafo) == chave, "pagina_da_fonte": (c.arquivo, c.pagina) == chave[:2]}
               for c in (ultimo.cartoes if ultimo else [])]
    return {"id": f["id"], "tipo": f["tipo"], "idioma": f["idioma"], "fala": f["fala"], "cartoes": cartoes, "primeiro_ms": primeiro,
            "total_ms": (time.perf_counter() - inicio) * 1000, "motivo": ultimo.motivo_silencio if ultimo else None,
            "alerta_risco": bool(ultimo and ultimo.alerta_risco), "clarificar": bool(ultimo and ultimo.clarificar)}


def pct(valores: list[float], p: float):
    return round(sorted(valores)[min(len(valores) - 1, int(p * len(valores)))]) if valores else None


def resumo(res: list[dict]) -> dict:
    pos = [r for r in res if r["tipo"] == "positivo"]
    s = {"total": len(res), "positivos": len(pos), "com_cartao": f"{sum(bool(r['cartoes']) for r in pos)}/{len(pos)}",
         "fonte_exata_em_algum_cartao": f"{sum(any(c['fonte_exata'] for c in r['cartoes']) for r in pos)}/{len(pos)}",
         "pagina_da_fonte_em_algum_cartao": f"{sum(any(c['pagina_da_fonte'] for c in r['cartoes']) for r in pos)}/{len(pos)}",
         "cartoes_por_caso_com_cartao": round(sum(len(r["cartoes"]) for r in pos) / max(1, sum(bool(r["cartoes"]) for r in pos)), 2),
         "primeiro_cartao_ms": {"p50": pct([r["primeiro_ms"] for r in pos if r["primeiro_ms"]], .5), "p95": pct([r["primeiro_ms"] for r in pos if r["primeiro_ms"]], .95)}}
    por_idioma = defaultdict(list)
    for r in pos:
        por_idioma[r["idioma"]].append(bool(r["cartoes"]))
    s["com_cartao_por_idioma"] = {k: f"{sum(v)}/{len(v)}" for k, v in por_idioma.items()}
    por = defaultdict(list)
    for r in res:
        if r["tipo"] != "positivo":
            por[r["tipo"]].append(r)
    s["negativos_com_cartao"] = {t: f"{sum(bool(r['cartoes']) for r in v)}/{len(v)}" for t, v in por.items()}
    s["ambiguo_pede_esclarecimento"] = f"{sum(r['clarificar'] for r in por.get('ambiguo', []))}/{len(por.get('ambiguo', []))}"
    return s


def ler(caminho: Path) -> list[dict]:
    return [json.loads(l) for l in caminho.read_text(encoding="utf-8").splitlines() if l.strip()] if caminho.exists() else []


def main() -> None:
    if sys.argv[1] == "--resumo":
        print(json.dumps(resumo(ler(Path(sys.argv[2]))), ensure_ascii=False, indent=1))
        return
    if not juiz_llm.configurado():
        raise SystemExit("Defina COPILOTO_JUIZ_URL")
    saida = Path(sys.argv[2])
    feitos = {r["id"] for r in ler(saida)}
    pendentes = [f for f in ler(Path(sys.argv[1])) if f["id"] not in feitos]
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    trava, contador, local = threading.Lock(), [0], threading.local()
    print(f"{len(pendentes)} falas a rodar ({len(feitos)} já feitas)", flush=True)

    def um(f):
        if not hasattr(local, "con"):
            local.con = conectar()
        r = rodar(local.con, f)
        with trava, saida.open("a", encoding="utf-8") as arq:
            arq.write(json.dumps(r, ensure_ascii=False) + "\n")
            contador[0] += 1
            if contador[0] % 100 == 0:
                print(f"{contador[0]}/{len(pendentes)}", flush=True)

    with ThreadPoolExecutor(int(sys.argv[3]) if len(sys.argv) > 3 else 4) as pool:
        list(pool.map(um, pendentes))
    print(json.dumps(resumo(ler(saida)), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
