"""A decisão de uma fala: o juiz pequeno diz se o paciente fala de si (vivência), a busca traz candidatos, os trechos
genéricos (marcados na preparação) saem, o juiz dá a cada um dos outros a nota de explicar a fala, e o melhor vira
cartão se passar do corte registrado."""
from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import asdict, dataclass, field

from . import busca, juiz, juiz_pequeno, qualificacao, risco

CANDIDATOS = int(os.environ.get("COPILOTO_CANDIDATOS_JUIZ", "24"))


def limiares() -> dict | None:
    """Os cortes registrados da versão do juiz (vivencia, generico, principal); None se a versão não tem limiar."""
    return qualificacao.limiares(juiz_pequeno.VERSAO)


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
    # The app reads a stream that ends on completo; the decision runs in one pass, so every answer is the last.
    completo: bool = True
    juiz: str = field(default_factory=lambda: juiz_pequeno.VERSAO)

    def para_json(self) -> dict:
        return asdict(self)


def _ms(inicio: float) -> float:
    return round((time.perf_counter() - inicio) * 1000, 1)


def decidir(
    con: sqlite3.Connection,
    fala: str,
    contexto: list[str] | None = None,
    falante: str = "paciente",
    obras_ids: list[str] | None = None,
    limites: dict | None = None,
    *,
    indice: busca.Indice | None = None,
    verificar_proveniencia=None,
) -> Decisao:
    contexto = contexto or []
    if falante != "paciente":
        motivo = "fala do terapeuta" if falante == "terapeuta" else "falante não identificado"
        return Decisao([], False, False, "nenhum", motivo)
    limites = limites or limiares()
    if limites is None:
        raise ValueError(f"A versão do juiz {juiz_pequeno.VERSAO!r} não tem limiar no registro.")
    tempos: dict[str, float] = {}
    inicio = time.perf_counter()
    # O risco não passa pelo piso de vivência: perder uma fala de risco custa mais que um alarme falso.
    alerta = risco.alerta(fala)
    tempos["risco"] = _ms(inicio)
    inicio = time.perf_counter()
    vivencia = juiz_pequeno.vivencia(fala)
    tempos["portao"] = _ms(inicio)
    canal = "geral" if vivencia >= limites["vivencia"] else "nenhum"
    triagem = {"clinica": canal == "geral", "probabilidade": vivencia, "canal": canal, "ambigua": False,
               "valida": True, "termos": "", "probabilidades": {"vivencia": vivencia}}
    if canal == "nenhum":
        return Decisao([], alerta, False, canal, "fala sem vivência do paciente", tempos, triagem)

    inicio = time.perf_counter()
    # The search reads the statement alone: earlier statements in the query drowned it (anchor in top-40: 21% vs 67%
    # on the gold).
    encontrados = busca.candidatos_amplos(con, fala, CANDIDATOS, obras_ids=obras_ids, indice=indice)
    tempos["busca"] = _ms(inicio)
    registros = [{"trecho_id": c.trecho_id, "arquivo": c.arquivo, "pagina": c.pagina, "paragrafo": c.paragrafo,
                  "posicao_busca": i, "generico": round(c.generico, 4)} for i, c in enumerate(encontrados)]
    especificos = [i for i, c in enumerate(encontrados) if c.generico <= limites["generico"]]
    if not especificos:
        motivo = "nenhum candidato no acervo" if not encontrados else "só trechos genéricos entre os candidatos"
        return Decisao([], alerta, False, canal, motivo, tempos, triagem, registros)

    inicio = time.perf_counter()
    notas = juiz_pequeno.principal(fala, [encontrados[i].texto for i in especificos])
    tempos["juiz"] = _ms(inicio)
    for i, nota in zip(especificos, notas, strict=True):
        registros[i]["juiz"] = round(nota, 4)
    melhor = max(range(len(notas)), key=notas.__getitem__)
    if notas[melhor] < limites["principal"]:
        return Decisao([], alerta, False, canal, "nenhum trecho com nota para cartão", tempos, triagem, registros)

    inicio = time.perf_counter()
    c = encontrados[especificos[melhor]]
    verificar = verificar_proveniencia if verificar_proveniencia is not None else busca._proveniencia_ok
    opcoes = list(juiz.opcoes_de_citacao(c.texto))
    if not opcoes or not verificar(c.arquivo, c.pagina, c.texto):
        tempos["citacao"] = _ms(inicio)
        return Decisao([], alerta, False, canal, "trecho sem citação literal conferida", tempos, triagem, registros)
    # The quote is the sentence of the winning passage the same judge ties closest to the statement.
    notas_citacao = juiz_pequeno.principal(fala, opcoes)
    citacao = opcoes[max(range(len(opcoes)), key=notas_citacao.__getitem__)]
    tempos["citacao"] = _ms(inicio)
    cartao = Cartao(
        trecho_id=c.trecho_id, obra_id=c.obra_id, arquivo=c.arquivo, titulo=c.titulo, autor=c.autor, idioma=c.idioma,
        pagina=c.pagina, paragrafo=c.paragrafo, texto=c.texto, citacao_literal=citacao, fala_paciente=fala,
        fenomeno_na_fala="", fenomeno_no_trecho="", canal=canal, probabilidade=round(notas[melhor], 4),
        # Every card cleared the one registered threshold; the app's "possivel" level is never sent.
        nivel="forte", contexto_paciente=list(contexto),
    )
    return Decisao([cartao], alerta, False, canal, None, tempos, triagem, registros)
