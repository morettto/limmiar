"""Testes de contrato do copiloto. Passam com qualquer decisor, porque o portão e o juiz são substituídos por duplos.

  .venv/Scripts/python.exe scripts/testes.py

Sai com código 1 se algum contrato falhar. A qualidade do decisor real mede-se à parte, em scripts/portao_qualidade.py.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

import httpx

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)
os.environ["COPILOTO_DECISOR"] = "local"

from copiloto import busca, decisao, embedder, juiz, parse, portao, traducao, treinado  # noqa: E402
from copiloto.esquema import DIR_PDFS, conectar, criar_esquema  # noqa: E402
from copiloto.juiz import Avaliacao  # noqa: E402
from copiloto.portao import Triagem  # noqa: E402

PISO_RECALL_CANDIDATOS = 0.50
falhas: list[str] = []


def verificar(nome: str, condicao: bool, detalhe: str = "") -> None:
    print(f"  [{'ok  ' if condicao else 'FALHA'}] {nome}" + (f"  {detalhe}" if detalhe else ""))
    if not condicao:
        falhas.append(nome)


def com_duplos(triagem: Triagem | None, avaliar):
    originais = (portao.triar, juiz.avaliar)
    portao.triar = (lambda *a, **k: triagem) if triagem else (lambda *a, **k: (_ for _ in ()).throw(AssertionError("portão chamado")))
    juiz.avaliar = avaliar
    return originais


def repor(originais) -> None:
    portao.triar, juiz.avaliar = originais


CLINICA = Triagem(clinica=True, probabilidade=0.99, canal="geral", ambigua=False, valida=True, termos="")


def aprova_primeiro(citacao_do_texto: bool = True):
    def avaliar(fala, contexto, trechos, cliente=None):
        saida = []
        for i, (tid, texto) in enumerate(trechos):
            cita = " ".join(texto.split()[:12]) if citacao_do_texto else "frase inventada que não existe em trecho nenhum do acervo"
            saida.append(Avaliacao(tid, i == 0, 0.99 if i == 0 else 0.01, "f", "f", cita if i == 0 else "",
                                   juiz.citacao_confere(cita, texto) if i == 0 else False))
        return saida
    return avaliar


def teste_parse(con) -> None:
    print("\n1. o parse preserva página e parágrafo")
    linha = con.execute("select arquivo from obra where status='pronto' limit 1").fetchone()
    blocos, paginas = parse.extrair(DIR_PDFS / linha["arquivo"])
    verificar("extraiu blocos", len(blocos) > 0, f"{len(blocos)}")
    verificar("páginas no intervalo", all(1 <= b.pagina <= paginas for b in blocos))
    verificar("parágrafos começam em 1", all(b.paragrafo >= 1 for b in blocos))


def teste_proveniencia(con) -> None:
    print("\n2. todo trecho indexado existe literalmente na página do PDF")
    linhas = con.execute("select t.texto, t.pagina, o.arquivo from trecho t join obra o on o.id=t.obra_id"
                         " where o.status='pronto' order by random() limit 60").fetchall()
    ok = sum(busca._proveniencia_ok(l["arquivo"], l["pagina"], l["texto"]) for l in linhas)
    verificar("60 trechos aleatórios conferidos no PDF", ok == len(linhas), f"{ok}/{len(linhas)}")


def teste_recall_candidatos(con) -> None:
    print(f"\n3. regressão da busca: o trecho certo entre os 20 candidatos (piso {PISO_RECALL_CANDIDATOS})")
    casos = [json.loads(l) for l in (RAIZ / "data" / "avaliacao" / "dev_positivos.jsonl").open(encoding="utf-8")]
    acertos = 0
    for c in casos:
        achados = {(x.arquivo, x.pagina) for x in busca.candidatos_amplos(con, c["fala"], c["idioma"], 20)}
        acertos += any((a["arquivo"], a["pagina"]) in achados for a in c["alvos"])
    taxa = acertos / len(casos)
    verificar(f"recall@20 >= {PISO_RECALL_CANDIDATOS}", taxa >= PISO_RECALL_CANDIDATOS, f"{acertos}/{len(casos)} = {taxa:.3f}")


def teste_silencios(con) -> None:
    print("\n4. o sistema falha para o silêncio")
    originais = com_duplos(None, lambda *a, **k: [])
    try:
        d = decisao.decidir(con, "você tem pensado em se matar?", [], "terapeuta")
        verificar("fala do terapeuta: sem cartão e sem chamar modelo", not d.cartoes and d.motivo_silencio == "fala do terapeuta")
    finally:
        repor(originais)

    originais = com_duplos(Triagem(False, 0.0, "nenhum", False, False), aprova_primeiro())
    try:
        d = decisao.decidir(con, "tenho pesadelos com o acidente", [], "paciente")
        verificar("portão indisponível: sem cartão", not d.cartoes and d.motivo_silencio == "portão indisponível")
    finally:
        repor(originais)

    originais = com_duplos(Triagem(False, 0.03, "nenhum", False, True), aprova_primeiro())
    try:
        d = decisao.decidir(con, "olá, tudo bem? que calor", [], "paciente")
        verificar("fala sem conteúdo clínico: sem cartão", not d.cartoes and d.motivo_silencio == "sem conteúdo clínico")
    finally:
        repor(originais)

    originais = com_duplos(CLINICA, lambda *a, **k: [])
    try:
        d = decisao.decidir(con, "tenho pesadelos com o acidente", [], "paciente")
        verificar("juiz indisponível: sem cartão", not d.cartoes and d.motivo_silencio == "juiz indisponível")
    finally:
        repor(originais)

    originais = com_duplos(Triagem(True, 0.99, "risco", True, True), aprova_primeiro())
    try:
        d = decisao.decidir(con, "às vezes dá vontade de sumir", [], "paciente")
        verificar("fala ambígua: alerta de clarificação e nenhuma referência", not d.cartoes and d.alerta_risco and d.clarificar)
    finally:
        repor(originais)


def teste_citacao(con) -> None:
    print("\n5. citação: só aparece cartão com citação que existe no trecho e no PDF")
    originais = com_duplos(CLINICA, aprova_primeiro(citacao_do_texto=False))
    try:
        d = decisao.decidir(con, "tenho pesadelos com o acidente e evito a rua", [], "paciente")
        verificar("citação inventada pelo juiz: sem cartão", not d.cartoes)
    finally:
        repor(originais)
    originais = com_duplos(CLINICA, aprova_primeiro())
    try:
        d = decisao.decidir(con, "tenho pesadelos com o acidente e evito a rua", [], "paciente")
        c = d.cartoes[0] if d.cartoes else None
        verificar("citação real aprovada: cartão emitido", c is not None)
        if c:
            verificar("cartão tem obra, autor, página e parágrafo", all([c.titulo, c.autor, c.pagina >= 1, c.paragrafo >= 1]))
            verificar("citação do cartão existe no texto do trecho", juiz.citacao_confere(c.citacao_literal, c.texto))
            verificar("texto do cartão confere com a página do PDF", busca._proveniencia_ok(c.arquivo, c.pagina, c.texto))
    finally:
        repor(originais)


def teste_limiar(con) -> None:
    print("\n6. limiar: aprovação com probabilidade abaixo do limiar do canal não gera cartão")
    def baixa(fala, contexto, trechos, cliente=None):
        tid, texto = trechos[0]
        cita = " ".join(texto.split()[:12])
        return [Avaliacao(tid, True, 0.6, "f", "f", cita, True)]
    originais = com_duplos(CLINICA, baixa)
    try:
        d = decisao.decidir(con, "tenho pesadelos com o acidente", [], "paciente", limites={"portao": 0.5, "juiz_geral": 0.9, "juiz_risco": 0.5})
        verificar("0,6 < 0,9 no canal geral: sem cartão", not d.cartoes)
    finally:
        repor(originais)


def teste_filtro(con) -> None:
    print("\n7. a seleção de obras restringe os candidatos")
    obra = con.execute("select id from obra where status='pronto' limit 1").fetchone()["id"]
    achados = busca.candidatos_amplos(con, "ansiedade e medo constante", "pt-BR", 20, [obra])
    verificar("todos os candidatos são da obra selecionada", bool(achados) and all(c.obra_id == obra for c in achados), f"{len(achados)}")
    verificar("obra inexistente: nenhum candidato", busca.candidatos_amplos(con, "ansiedade", "pt-BR", 20, ["nao-existe"]) == [])


def teste_api() -> None:
    print("\n8. contrato da API")
    from fastapi.testclient import TestClient

    from copiloto import pesquisa

    cliente = TestClient(pesquisa.app)
    saude = cliente.get("/api/saude").json()
    verificar("/api/saude diz decisor e modelo", {"decisor", "modelo", "trechos_no_indice"} <= set(saude))
    r = cliente.post("/api/consultar", json={"frase": "você tem pensado em se matar?", "falante": "terapeuta"}).json()
    verificar("terapeuta pela API: sem cartão", not r["cartoes"] and r["motivo_silencio"] == "fala do terapeuta")
    verificar("idioma inválido: 422", cliente.post("/api/consultar", json={"frase": "x", "idioma": "fr"}).status_code == 422)
    verificar("frase vazia: 422", cliente.post("/api/consultar", json={"frase": ""}).status_code == 422)
    verificar("candidatos internos não saem na API", "candidatos" not in r)


def teste_jev() -> None:
    print("\n9. protocolo do Jev (servidor simulado)")
    import subprocess

    r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "teste_jev.py")], capture_output=True, text=True, encoding="utf-8")
    verificar("teste_jev.py passa", r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1][:80])


def teste_modelo_indice(con) -> None:
    print("\n10. o índice usa o mesmo modelo que gerou os trechos")
    modelos = {l["modelo"] for l in con.execute("select distinct modelo from obra where status='pronto' and modelo is not null")}
    verificar("um único modelo no acervo", len(modelos) == 1, str(modelos))
    verificar("índice carregado com esse modelo", busca.INDICE.modelo in modelos, busca.INDICE.modelo)


def teste_treinado(con) -> None:
    print("\n11. decisor treinado (duplos no lugar dos modelos): mesmo contrato de silêncio, canais e citação")
    originais = (treinado.triar, treinado.julgar, os.environ["COPILOTO_DECISOR"])
    os.environ["COPILOTO_DECISOR"] = "treinado"
    limites = {"portao": 0.5, "juiz_geral": 0.9, "juiz_risco": 0.9, "ambigua": 0.5, "risco": 0.5}
    try:
        treinado.triar = lambda f, c: {"clinica": 0.02, "risco": 0.01, "ambigua": 0.01}
        treinado.julgar = lambda f, c, t: (_ for _ in ()).throw(AssertionError("juiz chamado"))
        d = decisao.decidir(con, "olá, tudo bem?", [], "paciente", limites=limites)
        verificar("fala neutra: silêncio sem chamar o juiz", not d.cartoes and d.motivo_silencio == "sem conteúdo clínico")
        d = decisao.decidir(con, "você pensa em se matar?", [], "terapeuta", limites=limites)
        verificar("fala do terapeuta: silêncio", not d.cartoes and d.motivo_silencio == "fala do terapeuta")
        treinado.triar = lambda f, c: {"clinica": 0.9, "risco": 0.8, "ambigua": 0.9}
        d = decisao.decidir(con, "às vezes dá vontade de sumir", [], "paciente", limites=limites)
        verificar("fala ambígua: clarificar, sem referência", not d.cartoes and d.clarificar and d.alerta_risco)
        treinado.triar = lambda f, c: {"clinica": 0.99, "risco": 0.01, "ambigua": 0.01}
        treinado.julgar = lambda f, c, t: [0.6] * len(t)
        d = decisao.decidir(con, "tenho pesadelos com o acidente e evito a rua", [], "paciente", limites=limites)
        verificar("nota abaixo do limiar: silêncio", not d.cartoes)
        treinado.julgar = lambda f, c, t: [0.97] + [0.1] * (len(t) - 1)
        d = decisao.decidir(con, "tenho pesadelos com o acidente e evito a rua", [], "paciente", limites=limites)
        c = d.cartoes[0] if d.cartoes else None
        verificar("nota acima do limiar: um cartão", c is not None and c.canal == "geral")
        if c:
            verificar("citação do cartão existe no trecho", juiz.citacao_confere(c.citacao_literal, c.texto))
            verificar("trecho do cartão confere com a página do PDF", busca._proveniencia_ok(c.arquivo, c.pagina, c.texto))
    finally:
        treinado.triar, treinado.julgar, os.environ["COPILOTO_DECISOR"] = originais


def teste_filtro_prosa() -> None:
    print("\n12. filtro de prosa na ingestão")
    verificar("referência bibliográfica cai", parse.motivo_descarte(
        "Chard, K. M., Schumm, J. A., McIlvain, S. M. (2011). Exploring the efficacy of a residential treatment. J. Trauma. Stress 24, 347–351. doi: 10.1002/jts.20644") == "referencia")
    verificar("linha de tabela cai", parse.motivo_descarte(
        "Sim 52 (36,9) 1,9 (0,85;4,21) 0,11 1,56 (0,76;3,18) 0,22 2,47 (1,22;4,98) 0,01 2,9 (1,43;5,89) <0,001 Tempo 1 mês 111 (84,7)") == "tabela")
    verificar("prosa clínica fica", parse.motivo_descarte(
        "O evitamento de lugares associados ao trauma é um sintoma central do TEPT. Os pacientes mudam de trajeto para não passar "
        "pelo local onde tudo aconteceu, mesmo que isso custe tempo e limite a vida diária.") is None)


def main() -> int:
    import subprocess

    regressao = subprocess.run([sys.executable, str(RAIZ / "scripts" / "test_confiabilidade.py")])
    if regressao.returncode:
        return regressao.returncode
    con = conectar()
    criar_esquema(con)
    busca.INDICE.recarregar(con)
    if busca.INDICE.vazio():
        print("acervo vazio; corra scripts/ingerir.py")
        return 1
    embedder.carregar(busca.INDICE.modelo)
    traducao.aquecer()
    print(f"acervo: {len(busca.INDICE.ids)} trechos, modelo {busca.INDICE.modelo}")
    teste_parse(con)
    teste_proveniencia(con)
    teste_recall_candidatos(con)
    teste_silencios(con)
    teste_citacao(con)
    teste_limiar(con)
    teste_filtro(con)
    teste_api()
    teste_jev()
    teste_modelo_indice(con)
    teste_treinado(con)
    teste_filtro_prosa()
    print("\n" + "-" * 60)
    if falhas:
        print(f"{len(falhas)} FALHA(S): " + "; ".join(falhas))
        return 1
    print("todos os contratos passaram")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
