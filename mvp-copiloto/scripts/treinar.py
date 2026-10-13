"""Treino do juiz local: o Jev ensina, o modelo local decide.

  python scripts/treinar.py ingestao     re-ingere o corpus ativo (COPILOTO_CORPUS) com o filtro de prosa e mede o que caiu
  python scripts/treinar.py candidatos   top-20 da busca para cada fala de dev (só dev)
  python scripts/treinar.py rotular      rótulos do Jev para os pares de dev, com cache e retoma (precisa de TYPESAFE_API_KEY)
  python scripts/treinar.py treinar <nome>   validação cruzada em 3 partes + modelo final (venv com CUDA)
  python scripts/treinar.py exportar <nome>                ONNX int8 em modelos/juiz-local/<nome>
  python scripts/treinar.py registos <nome>                registos fora-da-parte de dev para avaliar.py calibrar

Tudo o que é treino e calibração usa só dev. O corpus de teste só é tocado por avaliar.py e portao_qualidade.py.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto.treinado import consulta

DADOS = RAIZ / "data" / "avaliacao"
TREINO = RAIZ / "data" / "treino"
MODELOS = RAIZ / "modelos" / "juiz-local"
HF = RAIZ / "modelos" / "hf"
RESULTADOS = RAIZ / "resultados"
PARTES = 3
FRACAO_NEGATIVOS_DO_CASO = 0.3
ROTULOS_TRIAGEM = ("clinica", "risco", "ambigua")


def ler_jsonl(caminho: Path) -> list[dict]:
    if not caminho.exists():
        return []
    with caminho.open(encoding="utf-8") as fonte:
        return [json.loads(l) for l in fonte if l.strip()]


def gravar_jsonl(caminho: Path, linhas: list[dict]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in linhas), encoding="utf-8")


def casos(prefixo: str = "dev") -> list[dict]:
    if prefixo == "aug":
        return ler_jsonl(TREINO / "casos_aug.jsonl")
    return ler_jsonl(DADOS / f"{prefixo}_positivos.jsonl") + ler_jsonl(DADOS / f"{prefixo}_negativos.jsonl")


def parte(caso_id: str) -> int:
    return int(hashlib.sha256(caso_id.encode()).hexdigest(), 16) % PARTES


def grupo_da_fala(caso_id: str) -> str:
    return re.sub(r"^(p\d+)-(?:\d+|n)$", r"\1", caso_id)


def ingestao() -> None:
    from copiloto import busca, embedder, ingestao as ing, parse
    from copiloto.esquema import CAMINHO_BD, DIR_DADOS, conectar

    copia = CAMINHO_BD.with_name("acervo-sem-filtro.db")
    if not copia.exists():
        shutil.copy2(CAMINHO_BD, copia)
    antes = sqlite3.connect(copia)
    n_antes = antes.execute("select count(*) from trecho").fetchone()[0]
    con = conectar()
    busca.INDICE.modelo = embedder.PADRAO
    obras = con.execute("select id, arquivo from obra").fetchall()
    inicio = time.perf_counter()
    for obra in obras:
        con.execute("delete from trecho where obra_id = ?", (obra["id"],))
        con.commit()
        r = ing.processar(con, obra["id"])
        print(f"  {obra['arquivo'][:60]:<60} {'erro ' + r['erro'] if 'erro' in r else 'ok'}", flush=True)
    n_depois = con.execute("select count(*) from trecho").fetchone()[0]
    motivos: dict[str, int] = {}
    for (texto,) in antes.execute("select texto from trecho"):
        m = parse.motivo_descarte(texto)
        if m:
            motivos[m] = motivos.get(m, 0) + 1
    mantidos = {(r[0], r[1]) for r in con.execute("select o.arquivo, t.pagina from trecho t join obra o on o.id = t.obra_id")}
    mantidos_par = {(r[0], r[1], r[2]) for r in con.execute("select o.arquivo, t.pagina, t.paragrafo from trecho t join obra o on o.id = t.obra_id")}
    prefixo = "teste" if DIR_DADOS.name == "teste" else "dev"
    fontes = ler_jsonl(DIR_DADOS / "trechos_fonte.jsonl")
    fontes_perdidas = sum((f["arquivo"], f["pagina"], f["paragrafo"]) not in mantidos_par for f in fontes)
    positivos = ler_jsonl(DADOS / f"{prefixo}_positivos.jsonl")
    sem_alvo = [p["id"] for p in positivos if not any((a["arquivo"], a["pagina"]) in mantidos for a in p["alvos"])]
    medida = {"corpus": prefixo, "trechos_antes": n_antes, "trechos_depois": n_depois, "descartados_por_motivo": motivos,
              "trechos_fonte": len(fontes), "trechos_fonte_perdidos": fontes_perdidas,
              "positivos_sem_trecho_nas_paginas_alvo": len(sem_alvo), "segundos": round(time.perf_counter() - inicio)}
    destino = RESULTADOS / "filtro-ingestao.json"
    todas = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    todas[prefixo] = medida
    destino.write_text(json.dumps(todas, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(medida, ensure_ascii=False, indent=2))


def candidatos() -> None:
    from copiloto import busca, embedder, traducao
    from copiloto.esquema import CORPUS, conectar

    if CORPUS:
        raise SystemExit("candidatos só em dev")
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    destino = TREINO / "candidatos-dev.jsonl"
    feitos = {l["id"] for l in ler_jsonl(destino)}
    with destino.open("a", encoding="utf-8") as saida:
        for n, caso in enumerate(casos(), 1):
            if caso["id"] in feitos or caso["falante"] != "paciente":
                continue
            achados = busca.candidatos_amplos(con, consulta(caso["fala"], caso["contexto"]), caso["idioma"], 20)
            lista = [{"arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo, "trecho": c.texto} for c in achados]
            saida.write(json.dumps({"id": caso["id"], "candidatos": lista}, ensure_ascii=False) + "\n")
            saida.flush()
            if n % 50 == 0:
                print(f"  {n}", flush=True)


def _cache_antigo(prefixo: str) -> dict:
    registos = RESULTADOS / f"registos-{prefixo}-pipeline-jev.jsonl"
    base = RAIZ / "data" / ("teste/" if prefixo == "teste" else "") / "acervo-sem-filtro.db"
    if not registos.exists() or not base.exists():
        return {}
    bd = sqlite3.connect(base)
    paragrafo = {r[0]: r[1] for r in bd.execute("select id, paragrafo from trecho")}
    saida: dict = {}
    for r in ler_jsonl(registos):
        d = r["decisao"]
        t = (d.get("triagem") or {}).get("probabilidades")
        if t:
            saida[(r["id"], "triagem")] = t
        for c in d.get("candidatos", []):
            if c.get("juiz") and c["trecho_id"] in paragrafo:
                saida[(r["id"], c["arquivo"], int(c["pagina"]), paragrafo[c["trecho_id"]])] = c["juiz"]["probabilidade"]
    return saida


def cache_jev(prefixo: str) -> dict:
    arquivo = TREINO / f"jev-{prefixo}.jsonl"
    cache = _cache_antigo(prefixo)
    for l in ler_jsonl(arquivo):
        chave = (l["id"], "triagem") if "triagem" in l else (l["id"], l["arquivo"], l["pagina"], l["paragrafo"])
        cache[chave] = l.get("triagem", l.get("prob"))
    return cache


def pares_dev() -> dict[str, list[dict]]:
    por_caso: dict[str, list[dict]] = {}
    vistos = set()
    for l in ler_jsonl(TREINO / "candidatos-dev.jsonl"):
        for c in l["candidatos"]:
            chave = (l["id"], c["arquivo"], c["pagina"], c["paragrafo"])
            if chave not in vistos:
                vistos.add(chave)
                por_caso.setdefault(l["id"], []).append({**c, "origem": "busca"})
    for p in ler_jsonl(DADOS / "dev_pares.jsonl"):
        chave = (p["id"], p["arquivo"], p["pagina"], p["paragrafo"])
        if chave not in vistos:
            vistos.add(chave)
            por_caso.setdefault(p["id"], []).append({k: p[k] for k in ("arquivo", "pagina", "paragrafo", "trecho", "origem")})
    fonte = {(t["arquivo"], t["pagina"], t["paragrafo"]): t["texto"] for t in ler_jsonl(RAIZ / "data" / "trechos_fonte.jsonl")}
    for c in casos():
        f = c.get("fonte")
        if c["tipo"] == "positivo" and f:
            chave = (c["id"], f["arquivo"], f["pagina"], f["paragrafo"])
            texto = fonte.get((f["arquivo"], f["pagina"], f["paragrafo"]))
            if texto and chave not in vistos:
                vistos.add(chave)
                por_caso.setdefault(c["id"], []).append({"arquivo": f["arquivo"], "pagina": f["pagina"], "paragrafo": f["paragrafo"],
                                                         "trecho": texto, "origem": "rotulo"})
    return por_caso


def rotular(prefixo: str = "dev", por_caso: dict | None = None, lote: int = 20) -> None:
    import httpx

    from copiloto import jev, juiz

    if not jev.disponivel():
        raise SystemExit("sem TYPESAFE_API_KEY nem AI_GATEWAY_API_KEY no ambiente")
    os.environ.setdefault("COPILOTO_JEV_TENTATIVAS", "4")
    por_caso = por_caso if por_caso is not None else pares_dev()
    por_id = {c["id"]: c for c in casos(prefixo)}
    cache = cache_jev(prefixo)
    arquivo = TREINO / f"jev-{prefixo}.jsonl"
    pendentes = []
    for cid, lista in por_caso.items():
        falta = [p for p in lista if (cid, p["arquivo"], p["pagina"], p["paragrafo"]) not in cache]
        for i in range(0, len(falta), lote):
            pendentes.append((cid, falta[i:i + lote], (cid, "triagem") not in cache and i == 0))
    print(f"jev {prefixo}: {sum(len(f) for _, f, _ in pendentes)} pares por rotular em {len(pendentes)} pedidos", flush=True)
    with httpx.Client(timeout=60) as cliente, arquivo.open("a", encoding="utf-8") as saida:
        for n, (cid, falta, com_triagem) in enumerate(pendentes, 1):
            caso = por_id[cid]
            ids = [f"T{i + 1}" for i in range(len(falta))]
            estado = {"fala_do_paciente": caso["fala"], "falas_anteriores": caso["contexto"][-2:],
                      "trechos": {tid: p["trecho"] for tid, p in zip(ids, falta)}}
            perguntas = {tid: jev.sim_ou_nao(f"O trecho {tid} descreve o mesmo fenômeno clínico que o paciente expressa? {juiz.REGRAS_JEV}") for tid in ids}
            if com_triagem:
                perguntas.update(juiz.PERGUNTAS_TRIAGEM_JEV)
            try:
                respostas = jev.avaliar(estado, perguntas, cliente)
            except (httpx.HTTPError, KeyError, ValueError) as erro:
                print(f"  {cid}: {type(erro).__name__}", flush=True)
                continue
            for tid, p in zip(ids, falta):
                if tid in respostas and "probabilidade" in respostas[tid]:
                    saida.write(json.dumps({"id": cid, "arquivo": p["arquivo"], "pagina": p["pagina"], "paragrafo": p["paragrafo"],
                                            "prob": respostas[tid]["probabilidade"]}, ensure_ascii=False) + "\n")
            if com_triagem and all(k in respostas for k in ROTULOS_TRIAGEM):
                saida.write(json.dumps({"id": cid, "triagem": {k: respostas[k]["probabilidade"] for k in ROTULOS_TRIAGEM}}) + "\n")
            saida.flush()
            if n % 25 == 0:
                print(f"  {n}/{len(pendentes)}", flush=True)


TIPOS_TRIAGEM = {"R": ("positivo", "risco"), "G": ("positivo", "geral"), "A": ("ambiguo", "risco"), "N": ("neutro", "nenhum")}


def aumentar() -> None:
    """Falas escritas por Claude a partir dos PDFs de dev (pos/neg por trecho) e falas de triagem; busca top-20 e rótulo do Jev."""
    import sqlite3 as bd

    from copiloto import busca, embedder, traducao
    from copiloto.esquema import CAMINHO_BD, CORPUS, conectar

    if CORPUS:
        raise SystemExit("aumentar só em dev")
    passagens = {r: json.loads((TREINO / f"passagens_{r}.json").read_text(encoding="utf-8")) if (TREINO / f"passagens_{r}.json").exists() else []
                 for r in ("aug", "r3", "r4")}
    textos = {(r[0], r[1], r[2]): r[3] for r in bd.connect(CAMINHO_BD).execute(
        "select o.arquivo, t.pagina, t.paragrafo, t.texto from trecho t join obra o on o.id = t.obra_id")}
    lista = []
    for arquivo in sorted(TREINO.glob("falas_aug_*.tsv")) + sorted(TREINO.glob("falas_r3_*.tsv")) + sorted(TREINO.glob("falas_r4_*.tsv")):
        fonte = passagens[arquivo.name.split("_")[1]]
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            if not linha.strip():
                continue
            idx, rotulo, idioma, fala = linha.split("\t")
            a, pg, pr = fonte[int(idx)]
            base = {"id": f"aug-{len(lista):04d}", "fala": fala, "contexto": [], "idioma": idioma, "falante": "paciente",
                    "trecho_ref": {"arquivo": a, "pagina": pg, "paragrafo": pr}}
            lista.append({**base, "tipo": "positivo", "canal": "geral", "prior": 1.0} if rotulo == "pos" else
                         {**base, "tipo": "quase", "canal": "nenhum", "prior": 0.0})
    linhas_triagem = [l for nome in ("triagem_aug.tsv", "triagem_r3.tsv") if (TREINO / nome).exists()
                      for l in (TREINO / nome).read_text(encoding="utf-8").splitlines()]
    for n, linha in enumerate(linhas_triagem):
        if linha.strip():
            rotulo, idioma, fala = linha.split("\t")
            tipo, canal = TIPOS_TRIAGEM[rotulo]
            lista.append({"id": f"tri-{n:04d}", "fala": fala, "contexto": [], "idioma": idioma, "falante": "paciente",
                          "tipo": tipo, "canal": canal})
    gravar_jsonl(TREINO / "casos_aug.jsonl", lista)
    destino = TREINO / "candidatos-aug.jsonl"
    feitos = {l["id"] for l in ler_jsonl(destino)}
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    with destino.open("a", encoding="utf-8") as saida:
        for caso in lista:
            if caso["id"] in feitos:
                continue
            achados = [{"arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo, "trecho": c.texto}
                       for c in busca.candidatos_amplos(con, caso["fala"], caso["idioma"], 20)]
            ref = caso.get("trecho_ref")
            if ref and (ref["arquivo"], ref["pagina"], ref["paragrafo"]) in textos and not any(
                    (c["arquivo"], c["pagina"], c["paragrafo"]) == (ref["arquivo"], ref["pagina"], ref["paragrafo"]) for c in achados):
                achados.append({**ref, "trecho": textos[(ref["arquivo"], ref["pagina"], ref["paragrafo"])]})
            saida.write(json.dumps({"id": caso["id"], "candidatos": achados}, ensure_ascii=False) + "\n")
    print(f"{len(lista)} falas aumentadas", flush=True)
    rotular("aug", {l["id"]: l["candidatos"] for l in ler_jsonl(destino)})


def adjudicacoes(prefixo: str = "dev") -> dict:
    saida = {}
    for a in ler_jsonl(DADOS / f"{prefixo}_adjudicacoes.jsonl"):
        if type(a["valido"]) is not bool:
            raise ValueError("Adjudicação exige booleano estrito")
        chave = (a["id"], a["arquivo"], int(a["pagina"]))
        if chave in saida and saida[chave] != a["valido"]:
            raise ValueError("Adjudicações conflitantes")
        saida[chave] = a["valido"]
    return saida


def adjudicacoes_de_passagem() -> dict:
    revisoes = adjudicacoes()
    saida = {}
    for p in ler_jsonl(RESULTADOS / "adjudicar-dev.jsonl"):
        chave = (p["id"], p["arquivo"], int(p["pagina"]))
        if chave in revisoes:
            saida[(*chave, p["trecho_aprovado"])] = revisoes[chave]
    return saida


def conjunto_dev() -> tuple[list[dict], list[dict]]:
    """Pares (fala, trecho, alvo) e falas (fala, clinica, risco, ambigua). Rótulo do caso e adjudicação vencem o Jev."""
    por_caso = pares_dev()
    cache = cache_jev("dev")
    adjud = adjudicacoes_de_passagem()
    pares, falas = [], []
    for caso in casos():
        if caso["falante"] != "paciente":
            continue
        cid = caso["id"]
        tipo = caso["tipo"]
        q = consulta(caso["fala"], caso["contexto"])
        falas.append({"id": cid, "parte": parte(cid), "texto": q, "tipo": tipo,
                      "fala": caso["fala"], "contexto": caso["contexto"],
                      "clinica": float(tipo == "positivo"), "risco": float(caso["canal"] == "risco"),
                      "ambigua": float(tipo == "ambiguo"), "jev": cache.get((cid, "triagem"))})
        fonte = caso.get("fonte") or {}
        lista = por_caso.get(cid, [])
        for p in lista:
            j = cache.get((cid, p["arquivo"], p["pagina"], p["paragrafo"]))
            chave_passagem = (cid, p["arquivo"], int(p["pagina"]), p["trecho"])
            if tipo != "positivo":
                alvo, origem = 0.0, "caso"
            elif (p["arquivo"], p["pagina"], p["paragrafo"]) == (fonte.get("arquivo"), fonte.get("pagina"), fonte.get("paragrafo")):
                alvo, origem = 1.0, "caso"
            elif chave_passagem in adjud:
                alvo, origem = float(adjud[chave_passagem]), "adjudicacao"
            elif j is not None:
                alvo, origem = float(j), "jev"
            else:
                continue
            pares.append({"id": cid, "parte": parte(cid), "tipo": tipo, "q": q, "trecho": p["trecho"],
                          "fala": caso["fala"], "contexto": caso["contexto"],
                          "arquivo": p["arquivo"], "pagina": p["pagina"], "paragrafo": p["paragrafo"],
                          "alvo": alvo, "origem": origem, "jev": j})
    for f in ler_jsonl(TREINO / "triagem_sintetica.jsonl"):
        falas.append({**f, "parte": parte(f["id"]), "texto": consulta(f["fala"], f["contexto"]), "jev": None})
    aug_pares, aug_falas = conjunto_aug()
    claude = pares_claude()
    proibidos = passagens_prova()
    todos = [p for p in pares + aug_pares + claude + pares_contexto()
             if (p["arquivo"], p["pagina"], p["paragrafo"]) not in proibidos]
    return todos, falas + aug_falas


def passagens_prova() -> set:
    prova = ler_jsonl(DADOS / "produto_prova.jsonl")
    ids = {e for x in prova for e in x.get("esperados", [])} | {x["passagem"] for x in prova if x.get("passagem")}
    from copiloto.esquema import CAMINHO_BD
    linhas = sqlite3.connect(CAMINHO_BD).execute("select t.id, o.arquivo, t.pagina, t.paragrafo from trecho t join obra o on o.id = t.obra_id")
    return {(a, pg, pr) for i, a, pg, pr in linhas if i in ids}


def pares_claude() -> list[dict]:
    linhas = [l for nome in ("claude-r4.jsonl", "claude-r5.jsonl") for l in ler_jsonl(TREINO / nome)]
    revisoes = fontes_dev_revisadas(linhas)
    saida = []
    for l in linhas:
        revisao = revisoes.get((l["id"], l["arquivo"], l["pagina"], l["paragrafo"]))
        saida.append({"id": l["id"], "parte": parte(l["id"]), "tipo": "claude", "q": consulta(l["fala"], l.get("contexto", [])),
             "fala": l["fala"], "contexto": l.get("contexto", []),
             "trecho": l["trecho"], "arquivo": l["arquivo"], "pagina": l["pagina"],
             "paragrafo": l["paragrafo"], "alvo": float(revisao["valido"]) if revisao else l["alvo"],
             "origem": "fonte-dev" if revisao else "claude", "jev": None,
             "rotulo_revisado": revisao is not None or l["alvo"] == 1 or l.get("tipo") == "neg"})
    return saida


def fontes_dev_revisadas(linhas: list[dict]) -> dict:
    originais = {(p["id"], p["arquivo"], p["pagina"], p["paragrafo"]): p for p in linhas}
    revisoes = {}
    for r in ler_jsonl(TREINO / "fontes-dev-revisadas.jsonl"):
        chave = (r["id"], r["arquivo"], r["pagina"], r["paragrafo"])
        p = originais.get(chave)
        if not p or not re.fullmatch(r"r[45]-\d{4}", r["id"]):
            raise ValueError("Fonte revisada fora do desenvolvimento")
        if chave in revisoes:
            raise ValueError("Fonte revisada duplicada")
        if (type(r["valido"]) is not bool or not isinstance(r["justificativa"], str)
                or not r["justificativa"].strip() or not isinstance(r["revisor"], str) or not r["revisor"].strip()):
            raise ValueError("Fonte revisada exige booleano estrito, justificativa e revisor")
        q = consulta(p["fala"], p.get("contexto", []))
        if (r["fala_sha256"] != hashlib.sha256(q.encode()).hexdigest()
                or r["trecho_sha256"] != hashlib.sha256(p["trecho"].encode()).hexdigest()):
            raise ValueError("Fala, contexto ou passagem mudaram após a revisão")
        revisoes[chave] = r
    return revisoes


def rotulos_revisados(pares: list[dict]) -> list[dict]:
    saida = []
    for p in pares:
        if p["origem"] == "claude" and not p["rotulo_revisado"]:
            continue
        if p["origem"] not in ("claude", "contexto-dev", "fonte-dev", "adjudicacao", "caso"):
            continue
        grupo = grupo_da_fala(p["id"])
        if p["origem"] == "contexto-dev":
            grupo = p["id"].removeprefix("ctx-").rsplit("-", 1)[0]
        saida.append({**p, "grupo": grupo, "parte": parte(grupo)})
    return saida


def pares_contexto() -> list[dict]:
    saida = []
    for p in ler_jsonl(TREINO / "contexto-dev.jsonl"):
        if type(p["valido"]) is not bool or not p["justificativa"].strip():
            raise ValueError("Exemplo contextual exige booleano estrito e justificativa")
        saida.append({"id": p["id"], "parte": parte(p["grupo"]), "tipo": "contexto",
                      "fala": p["fala"], "contexto": p["contexto"],
                      "q": consulta(p["fala"], p["contexto"]), "trecho": p["trecho"],
                      "arquivo": p["arquivo"], "pagina": p["pagina"], "paragrafo": p["paragrafo"],
                      "alvo": float(p["valido"]), "origem": "contexto-dev", "jev": None})
    return saida


DISCORDANCIA = 0.7


def conjunto_aug() -> tuple[list[dict], list[dict]]:
    """Intenção de Claude é o prior, a nota do Jev é o alvo; cai o que discorda forte."""
    cache = cache_jev("aug")
    cands = {l["id"]: l["candidatos"] for l in ler_jsonl(TREINO / "candidatos-aug.jsonl")}
    pares, falas, caidos = [], [], 0
    rotulados_claude = {l["id"] for l in ler_jsonl(TREINO / "claude-r4.jsonl")}
    for caso in casos("aug"):
        cid, tipo = caso["id"], caso["tipo"]
        if cid in rotulados_claude:
            continue
        q = consulta(caso["fala"], caso["contexto"])
        alvo_t = {"clinica": float(tipo == "positivo"), "risco": float(caso["canal"] == "risco"), "ambigua": float(tipo == "ambiguo")}
        jt = cache.get((cid, "triagem"))
        if jt and any(abs(alvo_t[k] - jt[k]) > 0.8 for k in ("clinica", "risco")):
            caidos += 1
        else:
            falas.append({"id": cid, "parte": parte(cid), "texto": q, "tipo": tipo,
                          "fala": caso["fala"], "contexto": caso["contexto"], **alvo_t, "jev": jt})
        ref = caso.get("trecho_ref") or {}
        for p in cands.get(cid, []):
            j = cache.get((cid, p["arquivo"], p["pagina"], p["paragrafo"]))
            e_ref = (p["arquivo"], p["pagina"], p["paragrafo"]) == (ref.get("arquivo"), ref.get("pagina"), ref.get("paragrafo"))
            if e_ref:
                if j is None or abs(caso["prior"] - j) > DISCORDANCIA:
                    caidos += 1
                    continue
                alvo, origem = (j if caso["prior"] else 0.0), "aug-ref"
            elif tipo in ("quase", "neutro", "ambiguo"):
                alvo, origem = 0.0, "caso"
            elif j is not None:
                alvo, origem = float(j), "jev"
            else:
                continue
            pares.append({"id": cid, "parte": parte(cid), "tipo": tipo, "q": q, "trecho": p["trecho"],
                          "fala": caso["fala"], "contexto": caso["contexto"],
                          "arquivo": p["arquivo"], "pagina": p["pagina"], "paragrafo": p["paragrafo"],
                          "alvo": alvo, "origem": origem, "jev": j})
    if caidos:
        print(f"  aumentados: {caidos} exemplos caídos por discordância forte entre Claude e o Jev", flush=True)
    return pares, falas


from copiloto.treinado import reparar  # noqa: E402


def _dispositivo():
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def _treinar_um(cfg: dict, exemplos: list[dict], campos: tuple[str, ...], saida: Path | None, par: bool = True):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

    torch.manual_seed(13)
    origem = str(HF / cfg["hf"])
    tok = AutoTokenizer.from_pretrained(origem, trust_remote_code=True)
    modelo = AutoModelForSequenceClassification.from_pretrained(origem, num_labels=len(campos), trust_remote_code=True,
                                                                ignore_mismatched_sizes=True, dtype=getattr(torch, cfg.get("dtype", "float32")))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    modelo.config.pad_token_id = tok.pad_token_id
    modelo.config.problem_type = "multi_label_classification"
    reparar(modelo)
    if cfg.get("lora"):
        from peft import LoraConfig, TaskType, get_peft_model

        modelo = get_peft_model(modelo, LoraConfig(task_type=TaskType.SEQ_CLS, r=16, lora_alpha=32, lora_dropout=0.05,
                                                   target_modules=cfg["lora"]))
    elif cfg.get("congelar"):
        for nome, p in modelo.named_parameters():
            if "embed" in nome:
                p.requires_grad = False
    disp = _dispositivo()
    modelo.to(disp)
    precisao_mista = disp == "cuda" and cfg.get("dtype") == "float16"
    if precisao_mista:
        for parametro in modelo.parameters():
            if parametro.requires_grad:
                parametro.data = parametro.data.float()
    escalador = torch.amp.GradScaler("cuda", enabled=precisao_mista)
    try:
        modelo.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        if cfg.get("lora"):
            modelo.enable_input_require_grads()
    except (ValueError, AttributeError, TypeError):
        pass
    lote, acumular, epocas = cfg["lote"], cfg["acumular"], cfg["epocas"]
    otim = torch.optim.AdamW([p for p in modelo.parameters() if p.requires_grad], lr=cfg["lr"], weight_decay=0.01)
    lotes_por_epoca = (len(exemplos) + lote - 1) // lote
    passos = epocas * ((lotes_por_epoca + acumular - 1) // acumular)
    agenda = get_linear_schedule_with_warmup(otim, int(0.06 * passos), max(1, passos))
    gerador = torch.Generator().manual_seed(13)
    modelo.train()
    for epoca in range(epocas):
        ordem = torch.randperm(len(exemplos), generator=gerador).tolist()
        total = 0.0
        for k, i in enumerate(range(0, len(ordem), lote)):
            fatia = [exemplos[j] for j in ordem[i:i + lote]]
            enc = _codificar(tok, fatia, par, modelo.config.max_position_embeddings, cfg.get("formato")).to(disp)
            alvo = torch.tensor([[e[c] for c in campos] for e in fatia], dtype=torch.float32, device=disp)
            tamanho_acumulacao = min(acumular, lotes_por_epoca - (k // acumular) * acumular)
            with torch.autocast(device_type=disp, dtype=torch.float16, enabled=precisao_mista):
                logits = modelo(**enc).logits.float()
                pesos = _pesos_contrastes(fatia, cfg, disp)
                perda = torch.nn.functional.binary_cross_entropy_with_logits(logits, alvo, weight=pesos) / tamanho_acumulacao
            if not torch.isfinite(perda):
                raise ValueError("Perda não finita; treino interrompido sem publicar pesos.")
            escalador.scale(perda).backward()
            total += perda.item() * tamanho_acumulacao
            if (k + 1) % acumular == 0 or k + 1 == lotes_por_epoca:
                escalador.unscale_(otim)
                torch.nn.utils.clip_grad_norm_([p for p in modelo.parameters() if p.requires_grad], 1.0)
                escala_anterior = escalador.get_scale()
                escalador.step(otim)
                escalador.update()
                if escalador.get_scale() >= escala_anterior:
                    agenda.step()
                otim.zero_grad()
            if (k + 1) % 100 == 0:
                print(f"    época {epoca + 1}: {k + 1}/{lotes_por_epoca} lotes; perda {total / (k + 1):.4f}", flush=True)
        print(f"    época {epoca + 1}/{epocas} perda {total / max(1, k + 1):.4f}", flush=True)
    modelo.eval()
    if cfg.get("lora"):
        modelo = modelo.merge_and_unload()
    modelo.to(dtype=getattr(torch, cfg.get("dtype", "float32")))
    if saida:
        saida.mkdir(parents=True, exist_ok=True)
        modelo.save_pretrained(saida)
        tok.save_pretrained(saida)
        if cfg.get("formato"):
            (saida / "formato.txt").write_text(cfg["formato"], encoding="utf-8")
    return tok, modelo


def _codificar(tok, fatia: list[dict], par: bool, maximo: int, formato: str | None = None):
    if formato == "qwen-frase-v2":
        from copiloto.frase import formato_consulta

        enc = tok([formato_consulta(e["q"], e["trecho"]) for e in fatia], padding=True, truncation=False, return_tensors="pt")
    elif formato == "qwen":
        from copiloto.treinado import formato_qwen

        enc = tok([formato_qwen(e["q"], e["trecho"]) for e in fatia], padding=True, truncation=False, return_tensors="pt")
    elif par:
        enc = tok([e["q"] for e in fatia], [e["trecho"] for e in fatia], truncation=False,
                  padding=True, return_tensors="pt")
    else:
        enc = tok([e["texto"] for e in fatia], truncation=False, padding=True, return_tensors="pt")
    if enc["input_ids"].shape[1] > maximo:
        raise ValueError("Exemplo excede a capacidade do juiz; revise a passagem sem truncá-la.")
    return enc


def _pontuar(tok, modelo, exemplos: list[dict], par: bool, lote: int = 32, formato: str | None = None) -> list[list[float]]:
    import torch

    saida = []
    with torch.no_grad():
        for i in range(0, len(exemplos), lote):
            enc = _codificar(tok, exemplos[i:i + lote], par, modelo.config.max_position_embeddings, formato).to(modelo.device)
            saida += torch.sigmoid(modelo(**enc).logits.float()).tolist()
    return saida


CONFIG = {
    "mmbert-small": {"hf": "mmBERT-small", "lr": 5e-5, "lote": 8, "acumular": 4, "epocas": 2, "congelar": True},
    "gte-reranker": {"hf": "gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 1, "congelar": True},
    "gte-reranker-2ep": {"hf": "gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "gte-r2": {"hf": "gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "gte-r3": {"hf": "gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "gte-r4": {"hf": "gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "gte-r5": {"hf": "gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "gte-contexto": {"hf": "gte-multilingual-reranker-base", "lr": 1e-4, "lote": 1,
                     "acumular": 32, "epocas": 2, "rotulos_duros": True, "lora": ["qkv_proj", "o_proj"]},
    "gte-contexto-revisado": {"hf": "gte-multilingual-reranker-base", "lr": 1e-4, "lote": 1,
                            "acumular": 32, "epocas": 3, "rotulos_duros": True,
                            "rotulos_revisados": True, "lora": ["qkv_proj", "o_proj"]},
    "bge-reranker-r2": {"hf": "bge-reranker-v2-m3", "lr": 1e-4, "lote": 4, "acumular": 8, "epocas": 1,
                        "lora": ["query", "key", "value", "dense"]},
    "qwen-reranker-r2": {"hf": "Qwen3-Reranker-0.6B-seq-cls", "lr": 1e-4, "lote": 4, "acumular": 8, "epocas": 1, "formato": "qwen",
                         "lora": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]},
    "qwen-frase-r1": {"hf": "Qwen3-Reranker-0.6B-seq-cls", "lr": 5e-5, "lote": 4,
                       "acumular": 8, "epocas": 2, "formato": "qwen-frase-v2", "dtype": "float32",
                       "rotulos_duros": True, "rotulos_revisados": True,
                       "lora": ["q_proj", "k_proj", "v_proj", "o_proj"]},
    "qwen-frase-r2": {"hf": "Qwen3-Reranker-0.6B-seq-cls", "lr": 3e-5, "lote": 4,
                       "acumular": 8, "epocas": 1, "formato": "qwen-frase-v2", "dtype": "float32",
                       "rotulos_duros": True, "rotulos_revisados": True, "semantica_v2": True,
                       "peso_contraste_fonte": 8.,
                       "lora": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]},
}
FRACAO_NEGATIVOS_PESADOS = 0.35


def marcar_contrastes_fontes(pares: list[dict]) -> list[dict]:
    positivas = {p["q"] for p in pares if p["alvo"] == 1}
    incorretas = {p["q"] for p in pares if p["alvo"] == 0 and p["origem"] in ("fonte-dev", "adjudicacao")}
    contrastes = positivas & incorretas
    return [{**p, "contraste_fonte": p["q"] in contrastes} for p in pares]


def _pesos_contrastes(exemplos: list[dict], cfg: dict, dispositivo: str):
    import torch

    return torch.tensor([cfg.get("peso_contraste_fonte", 1.) if e.get("contraste_fonte") else 1.
                         for e in exemplos], dtype=torch.float32, device=dispositivo).unsqueeze(1)


def _amostra(p: dict, fracao: float) -> bool:
    return int(hashlib.sha256(f"{p['id']}{p['arquivo']}{p['pagina']}{p['paragrafo']}".encode()).hexdigest(), 16) % 100 < fracao * 100


def treinar(nome: str, final: bool = True, partes: list[int] | None = None) -> None:
    import torch

    cfg = CONFIG[nome]
    pares, _ = conjunto_dev()
    if cfg.get("rotulos_revisados"):
        originais = len(pares)
        pares = rotulos_revisados(pares)
        print(f"  rótulos sem adjudicação excluídos: {originais - len(pares)}; fontes alternativas não viram negativos", flush=True)
    if cfg.get("semantica_v2"):
        from copiloto.revisao_fontes import aplicar

        pares = aplicar(pares, TREINO / "fontes-dev-semantica-v2.jsonl")
    if cfg.get("semantica_v3"):
        # Segunda revisão dos contrastes de fonte, aplicada sobre a v2; ver data/treino/README.md.
        pares = aplicar(pares, TREINO / "fontes-dev-semantica-v3.jsonl")
    if cfg.get("formato") == "qwen-frase-v2":
        from copiloto.frase import consulta as consulta_frase

        pares = [{**p, "q": consulta_frase(p["fala"], p["contexto"])} for p in pares]
    validacao = [p for p in pares if p["origem"] != "caso" or p["alvo"] >= 0.5 or _amostra(p, FRACAO_NEGATIVOS_DO_CASO)]
    exemplos = validacao
    if cfg.get("rotulos_duros"):
        validacao = [p for p in validacao if p["origem"] in ("claude", "contexto-dev", "fonte-dev", "adjudicacao", "caso")]
        exemplos = [p for p in validacao if p["alvo"] >= .5 or p["origem"] in ("contexto-dev", "fonte-dev", "adjudicacao")
                    or _amostra(p, FRACAO_NEGATIVOS_DO_CASO)]
    elif cfg.get("lora"):
        exemplos = [p for p in validacao if p["alvo"] >= 0.1 or _amostra(p, FRACAO_NEGATIVOS_PESADOS)]
    validacao = marcar_contrastes_fontes(validacao)
    contrastes = {v["q"] for v in validacao if v["contraste_fonte"]}
    exemplos = [{**p, "contraste_fonte": p["q"] in contrastes} for p in exemplos]
    campos = ("alvo",)
    print(f"{nome}: {len(exemplos)} exemplos, {sum(e['alvo'] >= 0.5 for e in exemplos)} com alvo >= 0,5", flush=True)
    destino_oof = TREINO / f"oof-{nome}.jsonl"
    versao = {"pares_sha256": hashlib.sha256(json.dumps(exemplos, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
              "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "config": cfg, "partes": PARTES}
    if cfg.get("semantica_v2"):
        versao["revisao_fontes_sha256"] = hashlib.sha256((TREINO / "fontes-dev-semantica-v2.jsonl").read_bytes()).hexdigest()
    if cfg.get("formato") == "qwen-frase-v2":
        from copiloto import frase

        versao["formato_sha256"] = hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest()
    manifesto = destino_oof.with_suffix(".versao.json")
    if destino_oof.exists() or (MODELOS / nome / "torch").exists():
        if not manifesto.exists() or json.loads(manifesto.read_text(encoding="utf-8")) != versao:
            raise ValueError("Dados ou código mudaram: use outro nome para não reutilizar resultados fora-da-parte obsoletos.")
    manifesto.write_text(json.dumps(versao, indent=2), encoding="utf-8")
    feitos = {l["parte"] for l in ler_jsonl(destino_oof)}
    for k in (partes if partes is not None else range(PARTES)):
        if k in feitos:
            continue
        inicio = time.perf_counter()
        treino = [e for e in exemplos if e["parte"] != k]
        valida = [e for e in validacao if e["parte"] == k]
        tok, modelo = _treinar_um(cfg, treino, campos, None)
        notas = _pontuar(tok, modelo, valida, True, lote=4, formato=cfg.get("formato"))
        with destino_oof.open("a", encoding="utf-8") as saida:
            for e, n in zip(valida, notas):
                chave = {k2: e[k2] for k2 in ("id", "arquivo", "pagina", "paragrafo", "grupo") if k2 in e}
                saida.write(json.dumps({**chave, "parte": k, "contraste_fonte": e["contraste_fonte"],
                                       "notas": dict(zip(campos, n)), "alvo": {c: e[c] for c in campos}}) + "\n")
        print(f"  parte {k}: {len(treino)} treino, {len(valida)} validação, {time.perf_counter() - inicio:.0f} s", flush=True)
        del modelo
        torch.cuda.empty_cache()
    if final:
        inicio = time.perf_counter()
        torch.cuda.reset_peak_memory_stats() if torch.cuda.is_available() else None
        _treinar_um(cfg, exemplos, campos, MODELOS / nome / "torch")
        pico = torch.cuda.max_memory_allocated() / 2**30 if torch.cuda.is_available() else 0
        (MODELOS / nome / "treino.json").write_text(json.dumps({
            "hf": cfg["hf"], "exemplos": len(exemplos), "segundos_modelo_final": round(time.perf_counter() - inicio),
            "pico_vram_treino_gib": round(pico, 2), "config": cfg, "truncation": False,
            "pares_sha256": hashlib.sha256(json.dumps(exemplos, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}, indent=2), encoding="utf-8")
    metricas_oof(nome)


def _ajustar_logistica(X, Y, l2: float = 1e-3):
    import torch

    W = torch.zeros(X.shape[1], Y.shape[1], requires_grad=True)
    b = torch.zeros(Y.shape[1], requires_grad=True)
    positivos = Y.mean(0)
    peso = ((1 - positivos) / positivos.clamp(min=1e-3)).sqrt()
    otim = torch.optim.LBFGS([W, b], max_iter=300)

    def passo():
        otim.zero_grad()
        perda = torch.nn.functional.binary_cross_entropy_with_logits(X @ W * 10 + b, Y, pos_weight=peso) + l2 * (W ** 2).sum()
        perda.backward()
        return perda

    otim.step(passo)
    return W.detach(), b.detach()


def triagem() -> None:
    """Cabeça logística sobre o vetor bge-m3 da fala (o mesmo modelo da busca): sem VRAM extra, ~15 ms."""
    import numpy as np
    import torch

    from copiloto import embedder

    _, falas = conjunto_dev()
    X = torch.tensor(embedder.codificar_consultas([f["texto"] for f in falas]))
    Y = torch.tensor([[f[c] for c in ROTULOS_TRIAGEM] for f in falas], dtype=torch.float32)
    P = torch.tensor([f["parte"] for f in falas])
    linhas = []
    for k in range(PARTES):
        W, b = _ajustar_logistica(X[P != k], Y[P != k])
        notas = torch.sigmoid(X[P == k] @ W * 10 + b).tolist()
        for f, n in zip([f for f in falas if f["parte"] == k], notas):
            linhas.append({"id": f["id"], "parte": k, "notas": dict(zip(ROTULOS_TRIAGEM, n)), "alvo": {c: f[c] for c in ROTULOS_TRIAGEM}})
    gravar_jsonl(TREINO / "oof-triagem.jsonl", linhas)
    W, b = _ajustar_logistica(X, Y)
    destino = MODELOS / "triagem"
    destino.mkdir(parents=True, exist_ok=True)
    np.savez(destino / "logistica.npz", W=(W * 10).numpy(), b=b.numpy(), rotulos=np.array(ROTULOS_TRIAGEM), modelo=embedder.PADRAO)
    metricas_oof("triagem")


def auroc(pos: list[float], neg: list[float]) -> float:
    if not pos or not neg:
        return 0.0
    todos = sorted([(s, 1) for s in pos] + [(s, 0) for s in neg])
    soma, i = 0.0, 0
    while i < len(todos):
        j = i
        while j < len(todos) and todos[j][0] == todos[i][0]:
            j += 1
        media = (i + j + 1) / 2
        soma += media * sum(1 for x in todos[i:j] if x[1])
        i = j
    return (soma - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def metricas_oof(nome: str) -> None:
    linhas = ler_jsonl(TREINO / f"oof-{nome}.jsonl")
    if nome == "triagem":
        for c in ROTULOS_TRIAGEM:
            pos = [l["notas"][c] for l in linhas if l["alvo"][c] >= 0.5]
            neg = [l["notas"][c] for l in linhas if l["alvo"][c] < 0.5]
            print(f"  {c}: AUROC fora-da-parte {auroc(pos, neg):.3f} (n {len(pos)}/{len(neg)})")
        return
    pos = [l["notas"]["alvo"] for l in linhas if l["alvo"]["alvo"] >= 0.5]
    neg = [l["notas"]["alvo"] for l in linhas if l["alvo"]["alvo"] < 0.5]
    print(f"  juiz: AUROC fora-da-parte contra o alvo {auroc(pos, neg):.3f} (n {len(pos)}/{len(neg)})")


def exportar(nome: str) -> None:
    import numpy as np
    import onnxruntime as ort
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    origem = MODELOS / nome / "torch"
    tok = AutoTokenizer.from_pretrained(origem, trust_remote_code=True)
    modelo = AutoModelForSequenceClassification.from_pretrained(origem, trust_remote_code=True, dtype=torch.float32).eval()
    reparar(modelo)
    par = nome != "triagem"
    exemplo = tok(["uma frase de teste"], ["um trecho de teste"] if par else None, return_tensors="pt")
    nomes = [n for n in ("input_ids", "attention_mask", "token_type_ids") if n in exemplo]
    fp32 = MODELOS / nome / "modelo-fp32.onnx"
    eixos = {n: {0: "lote", 1: "tokens"} for n in nomes}
    eixos["logits"] = {0: "lote"}

    class Envolto(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, *args):
            return self.m(**dict(zip(nomes, args))).logits

    torch.onnx.export(Envolto(modelo), tuple(exemplo[n] for n in nomes), str(fp32), input_names=nomes, output_names=["logits"],
                      dynamic_axes=eixos, opset_version=17, dynamo=False)
    int8 = MODELOS / nome / "modelo-int8.onnx"
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)
    tok.save_pretrained(MODELOS / nome)
    sessao = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    enc = tok(["tenho pesadelos com o acidente"] * 2, ["Pesadelos recorrentes são típicos do TEPT."] * 2 if par else None,
              return_tensors="np", padding=True)
    onnx = sessao.run(None, {n: enc[n].astype(np.int64) for n in nomes})[0]
    with torch.no_grad():
        ref = modelo(**{n: torch.tensor(enc[n]) for n in nomes}).logits.numpy()
    print(f"{nome}: exportado; diferença máxima de logit int8 vs fp32 {float(np.abs(onnx - ref).max()):.3f}")
    fp32.with_suffix(".onnx.data").unlink(missing_ok=True)


def _registos_de(nome: str, so_parte: int | None = None) -> list[dict]:
    from copiloto.parse import motivo_descarte

    juizes = {(l["id"], l["arquivo"], l["pagina"], l["paragrafo"]): l["notas"]["alvo"] for l in ler_jsonl(TREINO / f"oof-{nome}.jsonl")}
    triagens = {l["id"]: l["notas"] for l in ler_jsonl(TREINO / "oof-triagem.jsonl")}
    candidatos_por_caso = {l["id"]: l["candidatos"] for l in ler_jsonl(TREINO / "candidatos-dev.jsonl")}
    saida = []
    for caso in casos():
        cid = caso["id"]
        if so_parte is not None and parte(cid) != so_parte:
            continue
        if caso["falante"] != "paciente":
            d = {"cartoes": [], "triagem": None, "candidatos": [], "tempos_ms": {}}
        else:
            t = triagens[cid]
            cands = []
            for i, c in enumerate(c for c in candidatos_por_caso.get(cid, []) if motivo_descarte(c["trecho"]) is None):
                p = juizes.get((cid, c["arquivo"], c["pagina"], c["paragrafo"]))
                if p is None:
                    continue
                cands.append({"trecho_id": f"{c['arquivo']}#{c['pagina']}#{c['paragrafo']}", "arquivo": c["arquivo"], "pagina": c["pagina"],
                              "paragrafo": c["paragrafo"], "posicao_busca": i,
                              "juiz": {"corresponde": p >= 0.5, "probabilidade": round(p, 4), "citacao_confere": True}})
            d = {"cartoes": [{**c, "probabilidade": c["juiz"]["probabilidade"]} for c in cands if c["juiz"]["corresponde"]],
                 "tipo_avaliacao": "modelo_sem_verificacao_de_proveniencia", "tempos_ms": {}, "candidatos": cands,
                 "triagem": {"valida": True, "clinica": t["clinica"] >= 0.5, "probabilidade": t["clinica"], "ambigua": t["ambigua"] >= 0.5,
                             "canal": "risco" if t["risco"] >= 0.5 else "geral", "probabilidades": t}}
        saida.append({"id": cid, "decisao": d, "total_ms": 0})
    return saida


def registos(nome: str) -> None:
    """Registos de dev no formato de avaliar.py, com notas fora-da-parte (nenhum caso é julgado por um modelo que o viu)."""
    saida = _registos_de(nome)
    gravar_jsonl(RESULTADOS / "registos-dev-pipeline-treinado.jsonl", saida)
    print(f"{len(saida)} registos fora-da-parte gravados")


def comparar(nomes: list[str]) -> None:
    """Mesma parte 0 do dev para todos: AUROC por origem do rótulo e cartões com os limiares de triagem atuais."""
    sys.path.insert(0, str(RAIZ / "scripts"))
    import avaliar

    pares, _ = conjunto_dev()
    origem = {(p["id"], p["arquivo"], p["pagina"], p["paragrafo"]): p for p in pares}
    lista = casos()
    adjud = avaliar.adjudicacoes("dev")
    jev_av = avaliar.avaliador_jev("dev")
    base = json.loads((RAIZ / "data" / "limiares-treinado.json").read_text(encoding="utf-8"))
    linhas = []
    for nome in nomes:
        oof = [l for l in ler_jsonl(TREINO / f"oof-{nome}.jsonl") if l["parte"] == 0]
        sel = [(l["notas"]["alvo"], origem.get((l["id"], l["arquivo"], l["pagina"], l["paragrafo"]))) for l in oof]
        sel = [(n, p) for n, p in sel if p and not p["id"].startswith(("aug-", "tri-"))]
        out = [f"{nome}"]
        for grupo in ("caso", "adjudicacao", "jev"):
            g = [(n, p) for n, p in sel if p["origem"] == grupo]
            out.append(f"AUROC {grupo} {auroc([n for n, p in g if p['alvo'] >= .5], [n for n, p in g if p['alvo'] < .5]):.3f}")
        duro = [(n, p) for n, p in sel if p["tipo"] == "positivo" and p["origem"] != "jev"]
        out.append(f"positivos rótulo duro {auroc([n for n, p in duro if p['alvo'] >= .5], [n for n, p in duro if p['alvo'] < .5]):.3f}")
        regs = _registos_de(nome, 0)
        for limiar in (0.8, 0.9, 0.95, 0.98):
            r = avaliar.resumo(regs, lista, {**base, "juiz_geral": limiar, "juiz_risco": limiar}, adjud, jev_av)
            out.append(f"@{limiar}: {r['cartoes_mostrados']} cartões, prec {r['precisao']}, LB {r['precisao_limite_inferior']}, "
                       f"por adjudicar {r['cartoes_por_adjudicar']}, cob {r['cobertura_geral']}")
        linhas.append("\n  ".join(out))
    texto = "\n".join(linhas)
    print(texto)
    with (RESULTADOS / "comparar-dev-parte0.txt").open("a", encoding="utf-8") as f:
        f.write(texto + "\n\n")


def avaliador(prefixo: str, modo: str) -> None:
    """Nota do Jev (avaliador, não rótulo) para cada candidato com juiz >= 0,5 em falas positivas sem rótulo nem adjudicação."""
    import httpx

    from copiloto import jev, juiz

    destino = DADOS / f"{prefixo}_avaliador_jev.jsonl"
    feitos = {(l["id"], l["arquivo"], l["pagina"], l["paragrafo"]) for l in ler_jsonl(destino)}
    cache = cache_jev(prefixo)
    por_id = {c["id"]: c for c in casos(prefixo)}
    adjud = adjudicacoes(prefixo)
    base = RAIZ / "data" / ("teste" if prefixo == "teste" else "") / "acervo.db"
    textos = {(r[0], r[1], r[2]): r[3] for r in sqlite3.connect(base).execute(
        "select o.arquivo, t.pagina, t.paragrafo, t.texto from trecho t join obra o on o.id = t.obra_id")}
    for l in ler_jsonl(TREINO / "candidatos-dev.jsonl") if prefixo == "dev" else []:
        for c in l["candidatos"]:
            textos[(c["arquivo"], c["pagina"], c["paragrafo"])] = c["trecho"]
    pedidos: dict[str, list] = {}
    prontos = []
    for r in ler_jsonl(RESULTADOS / f"registos-{prefixo}-{modo}.jsonl"):
        caso = por_id[r["id"]]
        if caso["tipo"] != "positivo":
            continue
        alvos = {(a["arquivo"], int(a["pagina"])) for a in caso["alvos"]}
        for c in r["decisao"].get("candidatos", []):
            j = c.get("juiz")
            chave = (r["id"], c["arquivo"], int(c["pagina"]), int(c.get("paragrafo", -1)))
            if not j or j["probabilidade"] < 0.5 or chave in feitos or (c["arquivo"], int(c["pagina"])) in alvos or chave[:3] in adjud:
                continue
            feitos.add(chave)
            if chave in cache:
                prontos.append({"id": chave[0], "arquivo": chave[1], "pagina": chave[2], "paragrafo": chave[3], "prob": cache[chave]})
            elif chave[1:] in textos:
                pedidos.setdefault(r["id"], []).append(chave)
    print(f"avaliador {prefixo}: {len(prontos)} notas já em cache, {sum(map(len, pedidos.values()))} por pedir ao Jev", flush=True)
    with destino.open("a", encoding="utf-8") as saida, httpx.Client(timeout=60) as cliente:
        for p in prontos:
            saida.write(json.dumps(p, ensure_ascii=False) + "\n")
        for cid, chaves in pedidos.items():
            caso = por_id[cid]
            ids = [f"T{i + 1}" for i in range(len(chaves))]
            estado = {"fala_do_paciente": caso["fala"], "falas_anteriores": caso["contexto"][-2:],
                      "trechos": {tid: textos[ch[1:]] for tid, ch in zip(ids, chaves)}}
            perguntas = {tid: jev.sim_ou_nao(f"O trecho {tid} descreve o mesmo fenômeno clínico que o paciente expressa? {juiz.REGRAS_JEV}") for tid in ids}
            try:
                respostas = jev.avaliar(estado, perguntas, cliente)
            except (httpx.HTTPError, KeyError, ValueError) as erro:
                print(f"  {cid}: {type(erro).__name__}", flush=True)
                continue
            for tid, ch in zip(ids, chaves):
                if "probabilidade" in respostas.get(tid, {}):
                    saida.write(json.dumps({"id": ch[0], "arquivo": ch[1], "pagina": ch[2], "paragrafo": ch[3],
                                            "prob": respostas[tid]["probabilidade"]}, ensure_ascii=False) + "\n")
            saida.flush()


def latencia(n: int = 150) -> None:
    """Latência por etapa com os limiares calibrados, no corpus ativo, como a API corre. Mede também o pico de VRAM e RAM."""
    import random

    import psutil
    import torch

    from copiloto import busca, decisao, embedder, traducao, treinado
    from copiloto.esquema import CORPUS, conectar

    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    treinado.aquecer()
    lista = [c for c in casos("teste" if CORPUS == "teste" else "dev") if c["falante"] == "paciente"]
    random.Random(5).shuffle(lista)
    torch.cuda.reset_peak_memory_stats() if torch.cuda.is_available() else None
    tempos: dict[str, list[float]] = {"total": []}
    for caso in lista[:n]:
        inicio = time.perf_counter()
        d = decisao.decidir(con, caso["fala"], caso["contexto"], "paciente", caso["idioma"])
        tempos["total"].append((time.perf_counter() - inicio) * 1000)
        for etapa, ms in d.tempos_ms.items():
            tempos.setdefault(etapa, []).append(ms)

    def pct(v, q):
        v = sorted(v)
        return round(v[min(len(v) - 1, int(q / 100 * len(v)))], 1)

    memoria = psutil.Process().memory_info()
    saida = {"decisor": decisao.decisor(), "juiz": treinado.NOME_JUIZ, "falas": min(n, len(lista)), "limiares": decisao.limiares(),
             "p50_ms": {k: pct(v, 50) for k, v in tempos.items()}, "p95_ms": {k: pct(v, 95) for k, v in tempos.items()},
             "chamadas_por_etapa": {k: len(v) for k, v in tempos.items()},
             "pico_vram_gib": round(torch.cuda.max_memory_allocated() / 2**30, 2) if torch.cuda.is_available() else 0,
             "ram_gib": round(getattr(memoria, "peak_wset", memoria.rss) / 2**30, 2),
             "dispositivo_embedder": os.environ.get("COPILOTO_EMBEDDER_DISPOSITIVO", "cpu")}
    print(json.dumps(saida, ensure_ascii=False, indent=2))
    destino = RESULTADOS / "latencia-local.json"
    todas = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    todas[f"{'teste' if CORPUS == 'teste' else 'dev'}-{saida['juiz']}-{saida['dispositivo_embedder']}-{decisao.CANDIDATOS_TREINADO}"] = saida
    destino.write_text(json.dumps(todas, ensure_ascii=False, indent=2), encoding="utf-8")


def wilson_inferior(certos: int, n: int, z: float = 1.96) -> float:
    if not n:
        return 0.0
    p = certos / n
    return (p + z * z / (2 * n) - z * ((p * (1 - p) + z * z / (4 * n)) / n) ** 0.5) / (1 + z * z / n)


def pares_teste() -> list[dict]:
    """Pares de teste com rótulo: caso (fonte = 1, fala negativa = 0) e adjudicação Claude; o resto leva a nota do Jev como avaliador."""
    base = sqlite3.connect(RAIZ / "data" / "teste" / "acervo-sem-filtro.db")
    paragrafo = {r[0]: r[1] for r in base.execute("select id, paragrafo from trecho")}
    cartao = {}
    for r in ler_jsonl(RESULTADOS / "registos-teste-pipeline-jev.jsonl"):
        for c in r["decisao"]["cartoes"]:
            cartao[(r["id"], c["arquivo"], int(c["pagina"]))] = c.get("paragrafo") or paragrafo.get(c["trecho_id"])
    adjud = adjudicacoes("teste")
    jev_teste = cache_jev("teste")
    por_id = {c["id"]: c for c in casos("teste")}
    saida = []
    for p in ler_jsonl(DADOS / "teste_pares.jsonl"):
        caso = por_id[p["id"]]
        f = caso.get("fonte") or {}
        chave_pag = (p["id"], p["arquivo"], int(p["pagina"]))
        if caso["tipo"] != "positivo":
            rotulo = 0.0
        elif (p["arquivo"], p["pagina"], p["paragrafo"]) == (f.get("arquivo"), f.get("pagina"), f.get("paragrafo")):
            rotulo = 1.0
        elif adjud.get(chave_pag) is False:
            rotulo = 0.0
        elif adjud.get(chave_pag) is True and cartao.get(chave_pag) == p["paragrafo"]:
            rotulo = 1.0
        else:
            rotulo = None
        saida.append({**p, "q": consulta(p["fala"], p["contexto"]), "trecho": p["trecho"], "rotulo": rotulo,
                      "jev": jev_teste.get((p["id"], p["arquivo"], p["pagina"], p["paragrafo"])),
                      "prosa": __import__("copiloto.parse", fromlist=["x"]).motivo_descarte(p["trecho"]) is None})
    return saida


def bench(nome: str) -> None:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    lista = pares_teste()
    if nome == "jev":
        notas = [p["jev"] if p["jev"] is not None else float("nan") for p in lista]
        ms_lote = None
    else:
        origem = next((str(c) for c in (MODELOS / nome / "torch", HF / nome) if c.exists()), nome)
        tok = AutoTokenizer.from_pretrained(origem, trust_remote_code=True)
        modelo = AutoModelForSequenceClassification.from_pretrained(origem, trust_remote_code=True, dtype=torch.float32)
        reparar(modelo)
        modelo.to(_dispositivo()).eval()
        torch.cuda.reset_peak_memory_stats() if torch.cuda.is_available() else None
        inicio = time.perf_counter()
        notas = [n[0] for n in _pontuar(tok, modelo, lista, True, lote=20)]
        ms_lote = (time.perf_counter() - inicio) * 1000 / (len(lista) / 20)
    linhas = []
    for grupo, filtro in (("rótulo Claude/caso", lambda p: p["rotulo"] is not None),
                          ("rótulo Claude/caso, só prosa", lambda p: p["rotulo"] is not None and p["prosa"]),
                          ("rótulo Claude/caso, pares que o Jev também julgou", lambda p: p["rotulo"] is not None and p["jev"] is not None),
                          ("Jev como avaliador (sem rótulo)", lambda p: p["rotulo"] is None and p["jev"] is not None)):
        sel = [(n, p["rotulo"] if p["rotulo"] is not None else float(p["jev"] >= 0.5)) for n, p in zip(notas, lista) if filtro(p) and n == n]
        validos = sum(r for _, r in sel)
        au = auroc([n for n, r in sel if r], [n for n, r in sel if not r])
        linhas.append(f"{nome} · {grupo}: n {len(sel)} ({int(validos)} válidos) AUROC {au:.3f}")
        for limiar in (0.5, 0.7, 0.8, 0.9, 0.95):
            aprov = [r for n, r in sel if n >= limiar]
            certos = int(sum(aprov))
            linhas.append(f"  limiar {limiar:<4} aprovados {len(aprov):4} precisão {certos / len(aprov) if aprov else 0:.3f} "
                          f"LB {wilson_inferior(certos, len(aprov)):.3f} recall {certos / validos if validos else 0:.3f}")
    if ms_lote is not None:
        import torch
        linhas.append(f"  {ms_lote:.0f} ms por lote de 20 pares; pico VRAM {torch.cuda.max_memory_allocated() / 2**30 if torch.cuda.is_available() else 0:.2f} GiB")
    texto = "\n".join(linhas)
    print(texto)
    with (RESULTADOS / "bench-local-teste.txt").open("a", encoding="utf-8") as saida:
        saida.write(texto + "\n\n")


if __name__ == "__main__":
    comando = sys.argv[1] if len(sys.argv) > 1 else ""
    if comando == "ingestao":
        ingestao()
    elif comando == "candidatos":
        candidatos()
    elif comando == "aumentar":
        aumentar()
    elif comando == "rotular":
        rotular()
    elif comando == "treinar":
        so_parte0 = "--parte0" in sys.argv
        treinar(sys.argv[2], final=not so_parte0, partes=[0] if so_parte0 else ([] if "--so-final" in sys.argv else None))
    elif comando == "exportar":
        exportar(sys.argv[2])
    elif comando == "registos":
        registos(sys.argv[2])
    elif comando == "triagem":
        triagem()
    elif comando == "comparar":
        comparar(sys.argv[2:])
    elif comando == "avaliador":
        avaliador(sys.argv[2], sys.argv[3])
    elif comando == "latencia":
        latencia()
    elif comando == "bench":
        bench(sys.argv[2])
    elif comando == "metricas":
        metricas_oof(sys.argv[2])
    else:
        print(__doc__)
