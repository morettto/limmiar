from __future__ import annotations

import json
import math
import os
import sqlite3
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from collections.abc import Callable, Iterator

import httpx

from . import busca, embedder, jev, juiz, juiz_llm, portao, qualificacao, treinado
from .esquema import RAIZ

CANDIDATOS_BUSCA = 20
CANDIDATOS_JUIZ = 4
CANDIDATOS_JEV = 20
CANDIDATOS_TREINADO = int(os.environ.get("COPILOTO_CANDIDATOS_TREINADO", "10"))
LOTE_FONTES = 8

LIMIARES_PADRAO = {
    "portao": 0.5,
    "juiz_geral": 0.9,
    "juiz_risco": 0.5,
    "juiz_forte": 0.99,
    "ambigua": 0.5,
    "risco": 0.5,
}


def decisor() -> str:
    if os.environ.get("COPILOTO_DECISOR"):
        return os.environ["COPILOTO_DECISOR"]
    if treinado.disponivel():
        return "treinado"
    return "jev" if jev.disponivel() else "local"


def _juiz_llm_ativo() -> bool:
    return decisor() == "treinado" and juiz_llm.configurado()


def arquivo_limiares():
    if _juiz_llm_ativo():
        return RAIZ / "data" / "limiares-juiz-llm.json"
    if decisor() == "treinado" and treinado.formato(treinado.NOME_JUIZ) == "qwen-frase-v2":
        return RAIZ / "data" / f"limiares-treinado-{treinado.NOME_JUIZ}.json"
    return RAIZ / "data" / f"limiares-{decisor()}.json"


def limiares() -> dict:
    arquivo = arquivo_limiares()
    limites = {**LIMIARES_PADRAO, **json.loads(arquivo.read_text(encoding="utf-8"))} if arquivo.exists() else dict(LIMIARES_PADRAO)
    # Com o juiz LLM, as faixas de cada versão são as do seu registro de promoção.
    if _juiz_llm_ativo() and (faixas := qualificacao.faixas(juiz_llm.VERSAO)):
        limites.update(juiz_forte=faixas["forte"], juiz_geral=faixas["possivel"], juiz_risco=faixas["possivel"])
    return limites


def nivel(probabilidade: float, limites: dict) -> str:
    return "forte" if probabilidade >= limites.get("juiz_forte", LIMIARES_PADRAO["juiz_forte"]) else "possivel"


@dataclass
class Cartao:
    trecho_id: str
    obra_id: str
    arquivo: str
    titulo: str
    autor: str
    idioma: str
    pagina: int
    paragrafo: int
    texto: str
    citacao_literal: str
    fala_paciente: str
    fenomeno_na_fala: str
    fenomeno_no_trecho: str
    canal: str
    probabilidade: float
    nivel: str
    contexto_paciente: list[str]


@dataclass
class Decisao:
    cartoes: list[Cartao]
    alerta_risco: bool
    clarificar: bool
    canal: str
    motivo_silencio: str | None
    tempos_ms: dict = field(default_factory=dict)
    triagem: dict | None = None
    candidatos: list[dict] = field(default_factory=list)
    completo: bool = True
    fontes_avaliadas: int = 0
    juiz: str = field(default_factory=lambda: juiz_llm.VERSAO)

    def para_json(self) -> dict:
        return asdict(self)


def _ms(inicio: float) -> float:
    return round((time.perf_counter() - inicio) * 1000, 1)


def decidir(
    con: sqlite3.Connection,
    fala: str,
    contexto: list[str] | None = None,
    falante: str = "paciente",
    idioma: str = "pt-BR",
    obras_ids: list[str] | None = None,
    limites: dict | None = None,
    julgar_sempre: bool = False,
    cliente: httpx.Client | None = None,
) -> Decisao:
    limites = limites or limiares()
    contexto = contexto or []
    tempos: dict[str, float] = {}
    if falante != "paciente":
        motivo = "fala do terapeuta" if falante == "terapeuta" else "falante não identificado"
        return Decisao([], False, False, "nenhum", motivo, tempos)

    if decisor() == "treinado":
        return _decidir_treinado(con, fala, contexto, idioma, obras_ids, limites)
    if decisor() == "jev":
        return _decidir_com_jev(con, fala, contexto, idioma, obras_ids, limites, cliente)

    inicio = time.perf_counter()
    triagem = portao.triar(fala, contexto, cliente)
    tempos["portao"] = _ms(inicio)
    registro_triagem = asdict(triagem)
    if not triagem.valida:
        return Decisao([], False, False, "nenhum", "portão indisponível", tempos, registro_triagem)

    risco = triagem.canal == "risco" or triagem.ambigua
    clinica = triagem.clinica and triagem.probabilidade >= limites["portao"]
    canal = "risco" if risco else ("geral" if clinica else "nenhum")
    if triagem.ambigua:
        return Decisao([], True, True, "risco", "fala ambígua: sugerir clarificação", tempos, registro_triagem)
    if not (clinica or risco or julgar_sempre):
        return Decisao([], False, False, "nenhum", "sem conteúdo clínico", tempos, registro_triagem)

    inicio = time.perf_counter()
    encontrados = busca.candidatos_amplos(
        con, treinado.consulta(fala, contexto), idioma, CANDIDATOS_BUSCA, obras_ids, extras=[triagem.termos],
    )
    tempos["busca"] = _ms(inicio)
    if not encontrados:
        return Decisao([], risco, False, canal, "nenhum candidato no acervo", tempos, registro_triagem)

    registros = [
        {"trecho_id": c.trecho_id, "arquivo": c.arquivo, "pagina": c.pagina, "posicao_busca": i}
        for i, c in enumerate(encontrados)
    ]
    finalistas = list(range(min(CANDIDATOS_JUIZ, len(encontrados))))

    inicio = time.perf_counter()
    avaliacoes = juiz.avaliar(fala, contexto, [(encontrados[i].trecho_id, encontrados[i].texto) for i in finalistas], cliente)
    tempos["juiz"] = _ms(inicio)
    return _escolher(avaliacoes, encontrados, finalistas, registros, risco, canal, fala, contexto, limites, tempos, registro_triagem)


def _anotar(registros: list[dict], avaliacoes) -> dict:
    por_trecho = {a.trecho_id: a for a in avaliacoes}
    for registro in registros:
        a = por_trecho.get(registro["trecho_id"])
        if a:
            registro["juiz"] = {"corresponde": a.corresponde, "probabilidade": round(a.probabilidade, 4),
                                "citacao_confere": a.citacao_confere, "fenomeno_na_fala": a.fenomeno_na_fala,
                                "fenomeno_no_trecho": a.fenomeno_no_trecho, "citacao_literal": a.citacao_literal}
    return por_trecho


def _escolher(avaliacoes, encontrados, finalistas, registros, risco, canal, fala, contexto, limites, tempos, registro_triagem,
              verificar_proveniencia=None) -> Decisao:
    por_trecho = _anotar(registros, avaliacoes)
    if not avaliacoes:
        return Decisao([], risco, False, canal, "juiz indisponível", tempos, registro_triagem, registros)

    inicio = time.perf_counter()
    limite_canal = limites["juiz_risco"] if risco else limites["juiz_geral"]
    aprovados = []
    for i in finalistas:
        a = por_trecho.get(encontrados[i].trecho_id)
        if (not a or a.corresponde is not True or not math.isfinite(a.probabilidade)
                or not 0 <= a.probabilidade <= 1 or a.probabilidade < limite_canal
                or not juiz.citacao_confere(a.citacao_literal, encontrados[i].texto)):
            continue
        c = encontrados[i]
        verificar = verificar_proveniencia if verificar_proveniencia is not None else busca._proveniencia_ok
        if not verificar(c.arquivo, c.pagina, c.texto):
            continue
        aprovados.append((a.probabilidade, c, a))
    tempos["verificacao"] = _ms(inicio)
    if not aprovados:
        return Decisao([], risco, False, canal, "nenhum trecho aprovado pelo juiz", tempos, registro_triagem, registros)
    cartoes = {}
    for prob, c, a in sorted(aprovados, key=lambda x: (-x[0], x[1].trecho_id)):
        if c.trecho_id in cartoes:
            continue
        probabilidade = round(prob, 4)
        cartoes[c.trecho_id] = Cartao(
            trecho_id=c.trecho_id, obra_id=c.obra_id, arquivo=c.arquivo, titulo=c.titulo, autor=c.autor,
            idioma=c.idioma, pagina=c.pagina, paragrafo=c.paragrafo, texto=c.texto,
            citacao_literal=a.citacao_literal, fala_paciente=fala, fenomeno_na_fala=a.fenomeno_na_fala,
            fenomeno_no_trecho=a.fenomeno_no_trecho, canal=canal, probabilidade=probabilidade,
            nivel=nivel(probabilidade, limites), contexto_paciente=list(contexto),
        )
    return Decisao(list(cartoes.values()), risco, False, canal, None, tempos, registro_triagem, registros)


def _decidir_com_jev(con, fala, contexto, idioma, obras_ids, limites, cliente) -> Decisao:
    tempos: dict[str, float] = {}
    inicio = time.perf_counter()
    encontrados = busca.candidatos_amplos(con, treinado.consulta(fala, contexto), idioma, CANDIDATOS_JEV, obras_ids)
    tempos["busca"] = _ms(inicio)
    finalistas = list(range(len(encontrados)))
    registros = [
        {"trecho_id": c.trecho_id, "arquivo": c.arquivo, "pagina": c.pagina, "posicao_busca": i}
        for i, c in enumerate(encontrados)
    ]
    inicio = time.perf_counter()
    probs, avaliacoes = juiz.avaliar_tudo_jev(fala, contexto, [(c.trecho_id, c.texto) for c in encontrados], cliente)
    tempos["jev"] = _ms(inicio)
    if probs is None:
        return Decisao([], False, False, "nenhum", "decisor indisponível", tempos, None, registros)
    _anotar(registros, avaliacoes)
    ambigua = probs["ambigua"] >= limites["ambigua"]
    risco = probs["risco"] >= limites["risco"] or ambigua
    clinica = probs["clinica"] >= limites["portao"]
    canal = "risco" if risco else ("geral" if clinica else "nenhum")
    registro_triagem = {"clinica": clinica, "probabilidade": probs["clinica"], "canal": canal,
                        "ambigua": ambigua, "valida": True, "termos": "", "probabilidades": probs}
    if ambigua:
        return Decisao([], True, True, "risco", "fala ambígua: sugerir clarificação", tempos, registro_triagem, registros)
    if not (clinica or risco):
        return Decisao([], False, False, "nenhum", "sem conteúdo clínico", tempos, registro_triagem, registros)
    if not encontrados:
        return Decisao([], risco, False, canal, "nenhum candidato no acervo", tempos, registro_triagem)
    return _escolher(avaliacoes, encontrados, finalistas, registros, risco, canal, fala, contexto, limites, tempos, registro_triagem)


def _decidir_treinado(con, fala, contexto, idioma, obras_ids, limites) -> Decisao:
    return deque(decidir_progressivamente(con, fala, contexto, "paciente", idioma, obras_ids, limites), maxlen=1)[0]


def decidir_progressivamente(con, fala: str, contexto: list[str], falante: str,
                            idioma: str, obras_ids: list[str] | None, limites: dict,
                            cancelada: Callable[[], bool] | None = None, inicio_fonte: int = 0, *,
                            indice: busca.Indice | None = None, verificar_proveniencia=None) -> Iterator[Decisao]:
    if falante != "paciente":
        yield Decisao([], False, False, "nenhum", "falante não identificado")
        return
    tempos: dict[str, float] = {}
    inicio = time.perf_counter()
    probs = treinado.triar(fala, contexto)
    tempos["portao"] = _ms(inicio)
    ambigua = probs["ambigua"] >= limites["ambigua"]
    risco = probs["risco"] >= limites["risco"] or ambigua
    clinica = probs["clinica"] >= limites["portao"]
    canal = "risco" if risco else ("geral" if clinica else "nenhum")
    registro_triagem = {"clinica": clinica, "probabilidade": probs["clinica"], "canal": canal, "ambigua": ambigua,
                        "valida": True, "termos": "", "probabilidades": probs}
    if ambigua:
        yield Decisao([], True, True, "risco", "fala ambígua: sugerir clarificação", tempos, registro_triagem)
        return
    if not (clinica or risco):
        yield Decisao([], False, False, "nenhum", "sem conteúdo clínico", tempos, registro_triagem)
        return
    inicio = time.perf_counter()
    consulta = treinado.consulta_para_modelo(fala, contexto)
    if juiz_llm.configurado():
        encontrados = busca.candidatos_amplos(con, consulta, idioma, juiz_llm.CANDIDATOS, obras_ids=obras_ids, indice=indice,
                                              extras=juiz_llm.reescrever(fala, contexto))
    else:
        encontrados = busca.candidatos_amplos(con, consulta, idioma, obras_ids=obras_ids, indice=indice)
    tempos["busca"] = _ms(inicio)
    if not encontrados:
        yield Decisao([], risco, False, canal, "nenhum candidato no acervo", tempos, registro_triagem)
        return
    if type(inicio_fonte) is not int or not 0 <= inicio_fonte < len(encontrados):
        raise ValueError("Posição de fonte inválida")
    registros = [
        {"trecho_id": c.trecho_id, "arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo, "posicao_busca": i}
        for i, c in enumerate(encontrados)
    ]
    limite_canal = limites["juiz_risco"] if risco else limites["juiz_geral"]
    cartoes = {}
    tempos["juiz"] = tempos["verificacao"] = tempos["citacao"] = 0.0
    for inicio_lote in range(inicio_fonte, len(encontrados), LOTE_FONTES):
        if cancelada is not None and cancelada():
            return
        lote = encontrados[inicio_lote:inicio_lote + LOTE_FONTES]
        inicio = time.perf_counter()
        notas = treinado.julgar(fala, contexto, [c.texto for c in lote])
        tempos["juiz"] += _ms(inicio)
        if len(notas) != len(lote):
            raise ValueError("O juiz não avaliou todas as fontes do lote")
        inicio = time.perf_counter()
        aprovados = [(c.texto, p) for c, p in zip(lote, notas, strict=True)
                     if math.isfinite(p) and limite_canal <= p <= 1]
        citacoes = iter(juiz.citacoes_qualificadas(fala, contexto, [texto for texto, _ in aprovados],
                                                [p for _, p in aprovados], limite_canal))
        tempos["citacao"] += _ms(inicio)
        avaliacoes = []
        for c, p in zip(lote, notas, strict=True):
            citacao, probabilidade = next(citacoes) if math.isfinite(p) and limite_canal <= p <= 1 else ("", p)
            avaliacoes.append(juiz.Avaliacao(
                trecho_id=c.trecho_id, corresponde=p >= 0.5, probabilidade=probabilidade, fenomeno_na_fala="", fenomeno_no_trecho="",
                citacao_literal=citacao, citacao_confere=bool(citacao) and juiz.citacao_confere(citacao, c.texto),
            ))
        medicao = {}
        resultado = _escolher(avaliacoes, lote, list(range(len(lote))), registros, risco, canal,
                             fala, contexto, limites, medicao, registro_triagem, verificar_proveniencia)
        tempos["verificacao"] += medicao.get("verificacao", 0.0)
        cartoes.update({c.trecho_id: c for c in resultado.cartoes})
        completo = inicio_lote + len(lote) == len(encontrados)
        fortes_primeiro = sorted(cartoes.values(), key=lambda c: (c.nivel != "forte", -c.probabilidade, c.trecho_id))
        yield Decisao(fortes_primeiro, risco, False, canal,
                      None if cartoes else ("nenhum trecho aprovado pelo juiz" if completo else "avaliando fontes"),
                      dict(tempos), registro_triagem, registros, completo, inicio_lote + len(lote))
        if completo:
            return
