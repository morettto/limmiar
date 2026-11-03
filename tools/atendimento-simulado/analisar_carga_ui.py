"""Resumo da carga ponta a ponta (apps/app/playwright.carga.config.ts): tempos, cartões, falhas e recursos.

Lê .local/simulacao-laya/e2e-ui/ (sessoes/*.json, acervo-*.json, recursos/amostras.jsonl) e grava resumo.json e
cartoes.jsonl (os cartões que apareceram, para a rotulagem cega). Cada resposta com cartão termina num desfecho e
cada frase do paciente também; resposta sem desfecho ou consulta sem frase faz a análise falhar. Uso: analisar_carga_ui.py
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import Counter
from pathlib import Path

PASTA = Path(__file__).resolve().parents[2] / ".local/simulacao-laya/e2e-ui"


def percentis(valores: list[float]) -> dict:
    if not valores:
        return {"n": 0}
    v = sorted(valores)
    return {"n": len(v), "p50": round(v[len(v) // 2]), "p90": round(v[int(len(v) * 0.9)]),
            "p99": round(v[min(len(v) - 1, int(len(v) * 0.99))]), "max": round(v[-1]), "media": round(statistics.mean(v))}


def recursos() -> dict:
    arquivo = PASTA / "recursos/amostras.jsonl"
    if not arquivo.exists():
        return {}
    servicos: dict[str, dict] = {}
    gpu_uso, gpu_mem, livre, containers = [], [], [], {}
    for linha in arquivo.read_text(encoding="utf-8").splitlines():
        a = json.loads(linha)
        for s in a["services"]:
            if s["pids"] and not s["cpu_warmup"]:
                d = servicos.setdefault(s["service"], {"rss_mb": [], "cpu_maquina_pct": []})
                d["rss_mb"].append(s["rss_bytes"] / 2**20)
                d["cpu_maquina_pct"].append(s["cpu_percent_machine"])
        for c in a["containers"]:
            containers.setdefault(c["Name"], []).append(c["MemUsage"])
        if a.get("gpu_total_csv"):
            partes = [p.strip() for p in a["gpu_total_csv"].split(",")]
            gpu_uso.append(float(partes[1]))
            gpu_mem.append(float(partes[2]))
        livre.append(a["system"]["memory_available_bytes"] / 2**20)
    return {
        "servicos": {n: {"rss_mb_media": round(statistics.mean(d["rss_mb"])), "rss_mb_pico": round(max(d["rss_mb"])),
                         "cpu_maquina_media_pct": round(statistics.mean(d["cpu_maquina_pct"]), 1),
                         "cpu_maquina_pico_pct": round(max(d["cpu_maquina_pct"]), 1)} for n, d in servicos.items()},
        "containers_ultima_memoria": {n: v[-1] for n, v in containers.items()},
        "gpu_uso_pct": percentis(gpu_uso), "gpu_mem_mb": percentis(gpu_mem), "ram_livre_mb_minima": round(min(livre)),
    }


def respondida(consulta: dict) -> bool:
    return consulta["status"] == 200 and bool(consulta["resposta"]) and not consulta["resposta"].get("erro")


def trechos(consulta: dict) -> set[str]:
    return {cartao["trecho_id"] for cartao in consulta["resposta"].get("cartoes") or []}


def reconciliar(sessao: dict) -> dict:
    """Desfecho de cada resposta com cartão e de cada frase do paciente, mais o fim da frase de cada consulta."""
    if sessao.get("naTela") is None:
        raise ValueError(f"{sessao['id']}: as marcas dos cartões na tela não foram lidas")
    ordem = [frase["frase"] for frase in sessao["frasesPaciente"]]
    fins: dict[str, float] = {}
    for frase in sessao["frasesPaciente"]:
        fins.setdefault(frase["frase"], frase["fimEm"])

    def ancoras(texto: str) -> list[str]:
        """Frases seguidas que a passada da fala inteira juntou; vazio se o texto não é uma fala inteira."""
        for i in range(len(ordem)):
            for j in range(i + 2, len(ordem) + 1):
                if " ".join(ordem[i:j]) == texto:
                    return ordem[i:j]
        return []

    consultas = sessao["consultas"]
    sem_frase = {c["frase"] for c in consultas if c["frase"] not in fins and not ancoras(c["frase"])}
    fim = {c["frase"]: fins[c["frase"]] if c["frase"] in fins else fins[ancoras(c["frase"])[-1]] for c in consultas if c["frase"] not in sem_frase}
    encerrada = sessao["sessaoEncerradaEm"]
    vistos: set[str] = set()
    cartoes = []
    for indice, consulta in enumerate(consultas):
        if not respondida(consulta) or consulta["frase"] in sem_frase:
            continue
        resposta = consulta["resposta"]
        so_fontes = not (resposta.get("clarificar") or resposta.get("alerta_risco"))
        if so_fontes and not resposta.get("cartoes"):
            continue
        turno = consulta["frase"] not in fins
        seguintes = [c for c in consultas[indice + 1:] if c["frase"] == consulta["frase"]]
        limite = min((c["respondidaEm"] for c in seguintes), default=float("inf"))
        # O botão de uma fala inteira é cada frase dela, com o id "turno:..."; o de uma frase é a própria frase.
        marca = next((m for m in sessao["naTela"] if consulta["respondidaEm"] <= m["emMs"] < limite
                      and m["id"].startswith("turno:") == turno
                      and (m["frase"] in consulta["frase"] if turno else m["frase"] == consulta["frase"])), None)
        das_ancoras = {t for c in consultas if turno and respondida(c) and c["frase"] in ancoras(consulta["frase"]) for t in trechos(c)}
        if marca:
            desfecho = "na_tela"
            vistos |= trechos(consulta)
        elif seguintes:
            desfecho = "superada"
        elif turno and so_fontes and trechos(consulta) <= das_ancoras:
            desfecho = "filtrada_por_ancora"
        elif so_fontes and trechos(consulta) <= vistos:
            desfecho = "trecho_repetido"
        elif encerrada is not None and consulta["respondidaEm"] >= encerrada:
            desfecho = "sessao_encerrada"
        else:
            desfecho = "sem_explicacao"
        cartoes.append({"desfecho": desfecho, "consulta": consulta, "marca": marca, "fim": fim[consulta["frase"]]})
    gravacao = sessao["gravacaoEncerradaEm"]
    frases: Counter[str] = Counter()
    for frase in sessao["frasesPaciente"]:
        enviadas = [c["enviadaEm"] for c in consultas if c["frase"] == frase["frase"]]
        frases["nunca_consultada" if not enviadas else
               "consultada_ao_vivo" if gravacao is None or min(enviadas) < gravacao else "adiada_por_idade"] += 1
    return {"cartoes": cartoes, "frases": frases, "sem_frase": sorted(sem_frase), "fim": fim}


def main() -> None:
    sessoes = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((PASTA / "sessoes").glob("*.json"))]
    consultas = [dict(c, sessao=s["id"]) for s in sessoes for c in s["consultas"]]
    ok = [c for c in consultas if respondida(c)]
    etapas = {e: percentis([c["resposta"]["tempos_ms"][e] for c in ok if e in (c["resposta"].get("tempos_ms") or {})])
              for e in ("risco", "portao", "busca", "juiz", "citacao")}
    cartoes = []
    for s in sessoes:
        for c in s["consultas"]:
            r = c["resposta"] or {}
            for k in r.get("cartoes") or []:
                cartoes.append({"sessao": s["id"], "tema": s["tema"], "fala": c["frase"], "trecho_id": k["trecho_id"],
                                "titulo": k["titulo"], "pagina": k["pagina"], "trecho": k["texto"],
                                "citacao": k["citacao_literal"], "probabilidade": k["probabilidade"],
                                "vivencia": (r.get("triagem") or {}).get("probabilidade")})
    with open(PASTA / "cartoes.jsonl", "w", encoding="utf-8") as arq:
        for k in cartoes:
            arq.write(json.dumps(k, ensure_ascii=False) + "\n")
    reconciliadas = {s["id"]: reconciliar(s) for s in sessoes}
    respostas = [(c, reconciliadas[s["id"]]["fim"][c["frase"]]) for s in sessoes for c in s["consultas"]
                 if respondida(c) and c["frase"] in reconciliadas[s["id"]]["fim"]]
    desfechos = [cartao for r in reconciliadas.values() for cartao in r["cartoes"]]
    na_tela = [cartao for cartao in desfechos if cartao["desfecho"] == "na_tela"]
    frases = sum((r["frases"] for r in reconciliadas.values()), Counter())
    total_frases = sum(frases.values())
    acervos = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(PASTA.glob("acervo-*.json"))]
    resumo = {
        "sessoes": {"total": len(sessoes), "visiveis": sum(s["visivel"] for s in sessoes),
                    "com_erro_na_pagina": sum(bool(s["erros"]) for s in sessoes),
                    "duracao_s": percentis([(s["fim"] - s["inicio"]) / 1000 for s in sessoes])},
        "acervo_preparo_s_por_profissional": {a["tema"]: a["preparoS"] for a in acervos},
        "falas_do_paciente": sum(len(s["falasPaciente"]) for s in sessoes),
        "frases_do_paciente": total_frases,
        "consultas": {"total": len(consultas), "respondidas": len(ok), "falhas": len(consultas) - len(ok),
                      "por_fala": round(len(consultas) / max(1, sum(len(s["falasPaciente"]) for s in sessoes)), 2),
                      "falhas_por_tipo": {str(k): sum(1 for c in consultas if c not in ok and (c["status"], (c["resposta"] or {}).get("erro")) == k)
                                          for k in {(c["status"], (c["resposta"] or {}).get("erro")) for c in consultas if c not in ok}}},
        "cartoes": len(cartoes), "silencios": {m: sum(1 for c in ok if c["resposta"].get("motivo_silencio") == m)
                                               for m in {c["resposta"].get("motivo_silencio") for c in ok}},
        "desfechos_das_respostas_com_cartao": dict(Counter(cartao["desfecho"] for cartao in desfechos)),
        "desfechos_das_frases": dict(frases),
        "frases_adiadas_pct": round(100 * frases["adiada_por_idade"] / max(1, total_frases), 1),
        "latencia_copiloto_ms": percentis([c["respondidaEm"] - c["enviadaEm"] for c in consultas]),
        "m1_fim_da_frase_ate_resposta_ms": percentis([c["respondidaEm"] - fim for c, fim in respostas]),
        "m2_resposta_ate_cartao_na_tela_ms": percentis([c["marca"]["emMs"] - c["consulta"]["respondidaEm"] for c in na_tela]),
        "m3_fim_da_frase_ate_cartao_na_tela_ms": percentis([c["marca"]["emMs"] - c["fim"] for c in na_tela]),
        "cartoes_na_janela_pct": round(100 * sum(c["marca"]["naJanela"] for c in na_tela) / max(1, len(na_tela)), 1),
        "etapas_copiloto_ms": etapas, "recursos": recursos(),
    }
    (PASTA / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False, indent=1))
    sem_explicacao = {sessao: {"respostas_sem_desfecho": sum(c["desfecho"] == "sem_explicacao" for c in r["cartoes"]),
                               "consultas_sem_frase": len(r["sem_frase"])}
                      for sessao, r in reconciliadas.items() if r["sem_frase"] or any(c["desfecho"] == "sem_explicacao" for c in r["cartoes"])}
    if sem_explicacao:
        sys.exit(f"FALHA: desfechos sem explicação {json.dumps(sem_explicacao, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
