"""Ronda 5: falas escritas por Claude, busca top-20 no dev fora do conjunto de produto, rótulos de Claude."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from treinar import DADOS, TREINO, gravar_jsonl, ler_jsonl  # noqa: E402

CANDIDATOS = TREINO / "candidatos-r5.jsonl"
SAIDA = TREINO / "claude-r5.jsonl"
CORTE = 320


def falas() -> list[dict]:
    lista = []
    for arquivo in sorted(TREINO.glob("falas_r5_*.tsv")):
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            if linha.strip():
                tipo, idioma, fala, *ancora = linha.split("\t")
                lista.append({"id": f"r5-{len(lista):04d}", "tipo": tipo, "idioma": idioma, "fala": fala, "ancora": [int(a) for a in ancora if a.strip()]})
    return lista


def proibidos() -> set:
    from copiloto.esquema import CAMINHO_BD

    ids = {e for nome in ("produto_ajuste", "produto_prova") for x in ler_jsonl(DADOS / f"{nome}.jsonl")
           for e in [*x.get("esperados", []), x.get("passagem")] if e}
    linhas = sqlite3.connect(CAMINHO_BD).execute("select t.id, o.arquivo, t.pagina, t.paragrafo from trecho t join obra o on o.id = t.obra_id")
    return {(a, pg, pr) for i, a, pg, pr in linhas if i in ids}


def candidatos() -> None:
    from copiloto import busca, embedder, traducao
    from copiloto.esquema import CORPUS, conectar

    if CORPUS:
        raise SystemExit("só em dev")
    fora = proibidos()
    feitos = {l["id"] for l in ler_jsonl(CANDIDATOS)}
    textos = {chave(c): c for l in ler_jsonl(CANDIDATOS) for c in l["candidatos"]}
    por_numero = {n: textos[k] for k, n in numeracao().items()}
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    with CANDIDATOS.open("a", encoding="utf-8") as saida:
        for f in falas():
            if f["id"] in feitos:
                continue
            achados = [{"arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo, "trecho": c.texto}
                       for c in busca.candidatos_amplos(con, f["fala"], f["idioma"], 32)
                       if (c.arquivo, c.pagina, c.paragrafo) not in fora][:20]
            achados += [por_numero[a] for a in f["ancora"] if chave(por_numero[a]) not in {chave(x) for x in achados}]
            saida.write(json.dumps({"id": f["id"], "fala": f["fala"], "candidatos": achados}, ensure_ascii=False) + "\n")
            saida.flush()


def chave(c: dict) -> tuple:
    return c["arquivo"], c["pagina"], c["paragrafo"]


def numeracao() -> dict:
    numeros: dict = {}
    for l in ler_jsonl(CANDIDATOS):
        for c in l["candidatos"]:
            numeros.setdefault(chave(c), len(numeros))
    return numeros


def despejar(de: str, ate: str) -> None:
    numeros = numeracao()
    tipos = {f["id"]: f["tipo"] for f in falas()}
    vistos = {numeros[chave(c)] for l in ler_jsonl(CANDIDATOS) if l["id"] < de and tipos[l["id"]] == "pos" for c in l["candidatos"]}
    for l in ler_jsonl(CANDIDATOS):
        if not de <= l["id"] <= ate:
            continue
        for c in l["candidatos"]:
            n = numeros[chave(c)]
            if n not in vistos:
                vistos.add(n)
                print(f"[{n}] {' '.join(c['trecho'].split())[:CORTE]}")
    print("====")
    for l in ler_jsonl(CANDIDATOS):
        if de <= l["id"] <= ate:
            print(f"{l['id']} | {l['fala']} | {' '.join(str(numeros[chave(c)]) for c in l['candidatos'])}")


def gravar() -> None:
    numeros = numeracao()
    positivos = {}
    for linha in (TREINO / "rotulos_claude_r5.txt").read_text(encoding="utf-8").splitlines():
        if ":" in linha:
            cid, resto = linha.split(":", 1)
            positivos[cid.strip()] = {int(x) for x in resto.split()}
    por_id = {f["id"]: f for f in falas()}
    linhas = []
    for l in ler_jsonl(CANDIDATOS):
        if l["id"] not in positivos:
            continue
        f = por_id[l["id"]]
        for c in l["candidatos"]:
            linhas.append({"id": l["id"], "fala": f["fala"], "idioma": f["idioma"], "tipo": f["tipo"], **{k: c[k] for k in ("arquivo", "pagina", "paragrafo", "trecho")},
                           "alvo": float(numeros[chave(c)] in positivos[l["id"]])})
    gravar_jsonl(SAIDA, linhas)
    print(f"{len(linhas)} pares, {sum(l['alvo'] for l in linhas):.0f} positivos, {len(positivos)} falas")


if __name__ == "__main__":
    {"candidatos": candidatos, "gravar": gravar}.get(sys.argv[1], lambda: despejar(sys.argv[2], sys.argv[3]))()
