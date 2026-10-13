"""Régua de avaliação do copiloto.

  COPILOTO_CORPUS=teste python scripts/avaliar.py correr     grava resultados/registos-<corpus>.jsonl (retoma se cair)
  COPILOTO_CORPUS=teste python scripts/avaliar.py base       sistema antigo: mostra sempre o 1.º resultado
  COPILOTO_CORPUS=teste python scripts/avaliar.py relatorio  métricas com data/limiares.json
  python scripts/avaliar.py calibrar                         escolhe limiares no corpus de desenvolvimento
"""

from __future__ import annotations

import itertools
import json
import logging
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import avaliacao, busca, decisao, embedder, traducao, metadados  # noqa: E402
from copiloto.esquema import CORPUS, RAIZ, conectar  # noqa: E402

PREFIXO = "teste" if CORPUS == "teste" else "dev"
DADOS = RAIZ / "data" / "avaliacao"
RESULTADOS = RAIZ / "resultados"
LIMIARES_REGISTO = {"portao": 0.2, "juiz_geral": 0.0, "juiz_risco": 0.0, "ambigua": 0.5, "risco": 0.1}
ALVO_PRECISAO = 0.88
ALVO_COBERTURA_RISCO = 0.95
TETO_FALSO_ALARME_NEUTRO = 0.01
ALVO_AMBIGUO_ALERTADO = 0.90


def casos(prefixo: str = PREFIXO) -> list[dict]:
    saida = []
    for nome in (f"{prefixo}_positivos.jsonl", f"{prefixo}_negativos.jsonl"):
        saida += [json.loads(linha) for linha in (DADOS / nome).open(encoding="utf-8") if linha.strip()]
    return saida


def adjudicacoes(prefixo: str = PREFIXO) -> dict[tuple[str, str, int], bool]:
    arquivo = DADOS / f"{prefixo}_adjudicacoes.jsonl"
    if not arquivo.exists():
        return {}
    saida = {}
    for linha in arquivo.open(encoding="utf-8"):
        if linha.strip():
            a = json.loads(linha)
            if type(a["valido"]) is not bool:
                raise ValueError("Revisão deve usar booleano estrito")
            chave = (a["id"], a["arquivo"], int(a["pagina"]))
            if a.get("paragrafo") is not None:
                saida[(*chave, int(a["paragrafo"]))] = a["valido"]
            elif a["valido"] is False:
                saida[chave] = False
    return saida


def avaliador_jev(prefixo: str = PREFIXO) -> dict[tuple[str, str, int, int], bool]:
    arquivo = DADOS / f"{prefixo}_avaliador_jev.jsonl"
    if not arquivo.exists():
        return {}
    saida = {}
    for linha in arquivo.open(encoding="utf-8"):
        if linha.strip():
            a = json.loads(linha)
            saida[(a["id"], a["arquivo"], int(a["pagina"]), int(a["paragrafo"]))] = a["prob"] >= 0.5
    return saida


def wilson_inferior(acertos: int, total: int, z: float = 1.96) -> float:
    if total == 0:
        return 0.0
    p = acertos / total
    centro = p + z * z / (2 * total)
    margem = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return round((centro - margem) / (1 + z * z / total), 4)


def correr(modo: str) -> None:
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    destino = RESULTADOS / f"registos-{PREFIXO}-{modo}.jsonl"
    assinatura = metadados.versao_pesquisa()
    arquivo_versao = destino.with_suffix(".versao.json")
    arquivo_versao.write_text(json.dumps(assinatura, indent=2), encoding="utf-8")
    pendentes = casos()
    print(f"{PREFIXO}/{modo}: avaliação nova de {len(pendentes)} casos", flush=True)
    with destino.open("w", encoding="utf-8") as saida:
        for n, caso in enumerate(pendentes, 1):
            inicio = time.perf_counter()
            if modo == "base":
                achados, _, _ = busca.consultar(con, caso["fala"], limite=1, verificar_proveniencia=False, idioma=caso["idioma"])
                registo = {"id": caso["id"], "base": [{"arquivo": c.arquivo, "pagina": c.pagina} for c in achados]}
            else:
                d = decisao.decidir(con, caso["fala"], caso["contexto"], caso["falante"], caso["idioma"], limites=LIMIARES_REGISTO)
                registo = {"id": caso["id"], "decisao": d.para_json()}
            registo["total_ms"] = round((time.perf_counter() - inicio) * 1000, 1)
            saida.write(json.dumps(registo, ensure_ascii=False) + "\n")
            saida.flush()
            if n % 25 == 0:
                print(f"  {n}/{len(pendentes)}", flush=True)


def _decidir_offline(registo: dict, limites: dict) -> tuple[list[dict], bool]:
    if "base" in registo:
        return registo["base"], False
    d = registo["decisao"]
    t = d.get("triagem")
    if not t or not t.get("valida"):
        return [], False
    probs = t.get("probabilidades")
    if probs:
        ambigua = probs["ambigua"] >= limites["ambigua"]
        risco = probs["risco"] >= limites.get("risco", 0.5) or ambigua
        clinica = probs["clinica"] >= limites["portao"]
    else:
        ambigua = t["ambigua"]
        risco = t["canal"] == "risco" or ambigua
        clinica = t["clinica"] and t["probabilidade"] >= limites["portao"]
    if ambigua:
        return [], True
    if not (clinica or risco):
        return [], risco
    limite = limites["juiz_risco"] if risco else limites["juiz_geral"]
    aprovados = [c for c in d["cartoes"] if c["probabilidade"] >= limite]
    return aprovados, risco


def resumo(registos: list[dict], lista_casos: list[dict], limites: dict, adjud: dict, jev_avaliador: dict | None = None) -> dict:
    por_id = {c["id"]: c for c in lista_casos}
    jev_avaliador = jev_avaliador or {}
    mostrados = corretos = pendentes = 0
    alarmes: dict[str, list[int]] = {}
    cobertura = {"geral": [0, 0], "risco": [0, 0]}
    risco_alertado = [0, 0]
    ambiguo_alertado = [0, 0]
    falso_risco = [0, 0]
    recall_candidatos = [0, 0]
    a_adjudicar = []
    tempos: dict[str, list[float]] = {"total": []}
    for r in registos:
        caso = por_id.get(r["id"])
        if not caso:
            continue
        cartoes, alerta = _decidir_offline(r, limites)
        tipo = caso["tipo"]
        if "decisao" in r:
            for etapa, ms in r["decisao"].get("tempos_ms", {}).items():
                tempos.setdefault(etapa, []).append(ms)
        tempos["total"].append(r.get("total_ms", 0))
        if tipo == "positivo":
            alvos = {(a["arquivo"], int(a["pagina"])) for a in caso["alvos"]}
            canal = caso["canal"]
            cobertura[canal][1] += 1
            if "decisao" in r:
                achados = {(c["arquivo"], int(c["pagina"])) for c in r["decisao"].get("candidatos", [])}
                recall_candidatos[1] += 1
                recall_candidatos[0] += bool(alvos & achados)
            if canal == "risco":
                risco_alertado[1] += 1
                risco_alertado[0] += alerta
            fala_coberta = False
            for cartao in cartoes:
                mostrados += 1
                chave = (cartao["arquivo"], int(cartao["pagina"]))
                fonte = caso.get("fonte") or {}
                fonte_exata = (cartao["arquivo"], int(cartao["pagina"]), cartao.get("paragrafo")) == (fonte.get("arquivo"), fonte.get("pagina"), fonte.get("paragrafo"))
                chave_revisao = (caso["id"], *chave, cartao.get("paragrafo"))
                if fonte_exata or adjud.get(chave_revisao) is True:
                    corretos += 1
                    fala_coberta = True
                elif chave_revisao not in adjud and adjud.get((caso["id"], *chave)) is not False:
                    pendentes += 1
                    a_adjudicar.append({"id": caso["id"], "fala": caso["fala"], "contexto": caso["contexto"],
                                        "fenomeno": caso["fenomeno"], "arquivo": chave[0], "pagina": chave[1],
                                        "paragrafo": cartao.get("paragrafo"), "trecho_id": cartao.get("trecho_id")})
            cobertura[canal][0] += fala_coberta
        else:
            alarmes.setdefault(tipo, [0, 0])
            alarmes[tipo][1] += 1
            if cartoes:
                mostrados += len(cartoes)
                alarmes[tipo][0] += 1
            if tipo == "ambiguo":
                ambiguo_alertado[1] += 1
                ambiguo_alertado[0] += alerta
            else:
                falso_risco[1] += 1
                falso_risco[0] += alerta

    def taxa(par: list[int]) -> float | None:
        return round(par[0] / par[1], 4) if par[1] else None

    return {
        "limiares": limites,
        "cartoes_mostrados": mostrados,
        "precisao": round(corretos / mostrados, 4) if mostrados and not pendentes else None,
        "precisao_limite_inferior": wilson_inferior(corretos, mostrados),
        "cartoes_por_adjudicar": pendentes,
        "cobertura_geral": taxa(cobertura["geral"]),
        "cobertura_risco_com_cartao": taxa(cobertura["risco"]),
        "risco_alertado": taxa(risco_alertado),
        "ambiguo_alertado": taxa(ambiguo_alertado),
        "falso_alerta_risco": taxa(falso_risco),
        "falso_alarme_por_tipo": {k: taxa(v) for k, v in alarmes.items()},
        "recall_candidatos": taxa(recall_candidatos),
        "latencia_p50_ms": {k: avaliacao.percentil(v, 50) for k, v in tempos.items() if v},
        "latencia_p95_ms": {k: avaliacao.percentil(v, 95) for k, v in tempos.items() if v},
        "a_adjudicar": a_adjudicar,
    }


def ler_registos(prefixo: str, modo: str) -> list[dict]:
    arquivo = RESULTADOS / f"registos-{prefixo}-{modo}.jsonl"
    return [json.loads(l) for l in arquivo.open(encoding="utf-8") if l.strip()]


def relatorio(modo: str) -> dict:
    limites = decisao.limiares()
    assinatura = json.loads((RESULTADOS / f"registos-{PREFIXO}-{modo}.versao.json").read_text(encoding="utf-8"))
    assert assinatura == metadados.versao_pesquisa(), "Código, modelos ou PDFs mudaram: gere nova avaliação"
    r = resumo(ler_registos(PREFIXO, modo), casos(), limites, adjudicacoes())
    r["versao"] = assinatura
    fila = RESULTADOS / f"adjudicar-{PREFIXO}-{modo}.jsonl"
    fila.write_text("".join(json.dumps(a, ensure_ascii=False) + "\n" for a in r.pop("a_adjudicar")), encoding="utf-8")
    destino = RESULTADOS / f"avaliacao-{PREFIXO}-{modo}.json"
    destino.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(r, ensure_ascii=False, indent=2))
    return r


def calibrar() -> None:
    registos = ler_registos("dev", f"pipeline-{decisao.decisor()}")
    lista = casos("dev")
    adjud = adjudicacoes("dev")
    jev_av = {}
    melhor = None
    reserva = None
    grade = {
        "portao": [0.2, 0.5, 0.8, 0.9, 0.95],
        "juiz_geral": [0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99],
        "juiz_risco": [0.3, 0.5, 0.7, 0.9],
        "ambigua": [0.5, 0.6, 0.7, 0.75, 0.8, 0.85],
        "risco": [0.1, 0.2, 0.3, 0.5],
    }
    for valores in itertools.product(*grade.values()):
        limites = dict(zip(grade.keys(), valores))
        r = resumo(registos, lista, limites, adjud, jev_av)
        neutro = r["falso_alarme_por_tipo"].get("neutro") or 0
        chave_reserva = (r["precisao_limite_inferior"], (r["cobertura_geral"] or 0) + (r["cobertura_risco_com_cartao"] or 0))
        if neutro <= TETO_FALSO_ALARME_NEUTRO and (r["ambiguo_alertado"] or 0) >= ALVO_AMBIGUO_ALERTADO and (
                reserva is None or chave_reserva > reserva[0]):
            reserva = (chave_reserva, limites, r)
        if (r["precisao_limite_inferior"] < ALVO_PRECISAO or neutro > TETO_FALSO_ALARME_NEUTRO
                or (r["risco_alertado"] or 0) < ALVO_COBERTURA_RISCO
                or (r["ambiguo_alertado"] or 0) < ALVO_AMBIGUO_ALERTADO):
            continue
        chave = ((r["cobertura_geral"] or 0) + (r["cobertura_risco_com_cartao"] or 0), -sum(valores))
        if melhor is None or chave > melhor[0]:
            melhor = (chave, limites, r)
    if melhor is None:
        print("nenhuma combinação de limiares atinge precisão com limite inferior >= 0,88 no conjunto de desenvolvimento")
        if reserva is None:
            return
        print("Os limiares atuais foram preservados: nenhuma configuração passou o contrato.")
        return
    _, limites, r = melhor
    decisao.arquivo_limiares().write_text(json.dumps(limites, indent=2), encoding="utf-8")
    r.pop("a_adjudicar", None)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    print(f"limiares gravados em {decisao.arquivo_limiares()}")


if __name__ == "__main__":
    comando = sys.argv[1] if len(sys.argv) > 1 else "relatorio"
    if comando in ("correr", "base"):
        correr(f"pipeline-{decisao.decisor()}" if comando == "correr" else "base")
    elif comando == "calibrar":
        calibrar()
    else:
        relatorio(sys.argv[2] if len(sys.argv) > 2 else f"pipeline-{decisao.decisor()}")
