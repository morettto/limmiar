import json
import os
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

from copiloto import avaliacao, busca, decisao, embedder, treinado
from copiloto.esquema import conectar

PASTA = RAIZ / "data" / "avaliacao"


def carregar(parte):
    return [json.loads(l) for l in open(PASTA / f"produto_{parte}.jsonl", encoding="utf-8")]


def correr(parte, rotulo):
    itens = carregar(parte)
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    treinado.aquecer()
    saida = RAIZ / "resultados" / f"produto-{parte}-{rotulo}.jsonl"
    with open(saida, "w", encoding="utf-8") as f:
        for item in itens:
            contexto = item.get("contexto", [])
            inicio = time.perf_counter()
            d = decisao.decidir(con, item["fala"], contexto, "paciente", item["idioma"])
            ms = (time.perf_counter() - inicio) * 1000
            amplos = busca.candidatos_amplos(con, item["fala"], item["idioma"], 20)
            notas = treinado.julgar(item["fala"], contexto, [c.texto for c in amplos])
            registro = {**item, "contexto": contexto, "ms": round(ms, 1), "tempos": d.tempos_ms,
                        "cartoes": [vars(c) for c in d.cartoes],
                        "decisao": d.para_json(),
                        "motivo": d.motivo_silencio, "triagem": (d.triagem or {}).get("probabilidades"),
                        "clarificar": d.clarificar, "risco": d.alerta_risco,
                        "top20": [[c.trecho_id, round(p, 4)] for c, p in zip(amplos, notas)]}
            f.write(json.dumps(registro, ensure_ascii=False) + "\n")
    try:
        import torch
        vram = round(torch.cuda.max_memory_reserved() / 2**30, 2)
    except Exception:
        vram = None
    print(f"gravado {saida} (VRAM pico {vram} GiB)")


def relatorio(parte, rotulo):
    regs = [json.loads(l) for l in open(RAIZ / "resultados" / f"produto-{parte}-{rotulo}.jsonl", encoding="utf-8")]
    arquivo_revisoes = PASTA / f"produto_{parte}_adjudicacoes.jsonl"
    revisoes = [json.loads(l) for l in arquivo_revisoes.read_text(encoding="utf-8").splitlines() if l.strip()] if arquivo_revisoes.exists() else []
    metricas = avaliacao.avaliar_referencias(carregar(parte), regs, revisoes)
    print(json.dumps(metricas, ensure_ascii=False, indent=2))
    return regs


def causa(r):
    limites = decisao.limiares()
    if r["motivo"] in ("sem conteúdo clínico",) or r["clarificar"]:
        return "triagem"
    ids = [t for t, _ in r["top20"]]
    presentes = [(i, p) for i, (t, p) in enumerate(r["top20"]) if t in r["esperados"]]
    if not presentes:
        return "busca"
    if all(i >= decisao.CANDIDATOS_TREINADO for i, _ in presentes):
        return "busca (fora do topo)"
    limite = limites["juiz_risco"] if r["risco"] else limites["juiz_geral"]
    if max(p for i, p in presentes if i < decisao.CANDIDATOS_TREINADO) < limite:
        return "juiz"
    return "citação/proveniência" if not r["cartoes"] else "referências precisam de revisão"


def rejulgar(parte, origem, rotulo):
    con = conectar()
    textos = dict(con.execute("select id, texto from trecho"))
    with open(RAIZ / "resultados" / f"produto-{parte}-{rotulo}.jsonl", "w", encoding="utf-8") as f:
        for l in open(RAIZ / "resultados" / f"produto-{parte}-{origem}.jsonl", encoding="utf-8"):
            r = json.loads(l)
            notas = treinado.julgar(r["fala"], r["contexto"], [textos[t] for t, _ in r["top20"]])
            r["top20"] = [[t, round(p, 4)] for (t, _), p in zip(r["top20"], notas)]
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    acao, parte, rotulo = sys.argv[1], sys.argv[2], sys.argv[3]
    if acao == "correr":
        correr(parte, rotulo)
    if acao == "rejulgar":
        rejulgar(parte, sys.argv[4], rotulo)
        sys.exit()
    relatorio(parte, rotulo)
