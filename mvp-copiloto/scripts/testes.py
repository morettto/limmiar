"""Testes de contrato do copiloto. O juiz é substituído por duplos: nenhum modelo de decisão carrega.

  .venv/Scripts/python.exe scripts/testes.py

Sai com código 1 se algum contrato falhar. A qualidade do juiz mede-se à parte, no gabarito de tools/atendimento-simulado/gold.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import busca, decisao, embedder, juiz, juiz_pequeno, parse  # noqa: E402
from copiloto.esquema import DIR_PDFS, conectar, criar_esquema  # noqa: E402

PISO_RECALL_CANDIDATOS = 0.50
falhas: list[str] = []


def verificar(nome: str, condicao: bool, detalhe: str = "") -> None:
    print(f"  [{'ok  ' if condicao else 'FALHA'}] {nome}" + (f"  {detalhe}" if detalhe else ""))
    if not condicao:
        falhas.append(nome)


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
        achados = {(x.arquivo, x.pagina) for x in busca.candidatos_amplos(con, c["fala"], 20)}
        acertos += any((a["arquivo"], a["pagina"]) in achados for a in c["alvos"])
    taxa = acertos / len(casos)
    verificar(f"recall@20 >= {PISO_RECALL_CANDIDATOS}", taxa >= PISO_RECALL_CANDIDATOS, f"{acertos}/{len(casos)} = {taxa:.3f}")


def teste_decisao(con) -> None:
    print("\n4. decisão (duplos no lugar do juiz): silêncio, corte e citação conferida")
    originais = (juiz_pequeno.vivencia, juiz_pequeno.principal)
    limites = {"vivencia": 0.5, "generico": 1.0, "principal": 0.9}
    fala = "tenho pesadelos com o acidente e evito a rua"
    try:
        juiz_pequeno.vivencia = lambda f: 0.02
        juiz_pequeno.principal = lambda f, t: (_ for _ in ()).throw(AssertionError("juiz chamado"))
        d = decisao.decidir(con, "olá, tudo bem?", [], "paciente", limites=limites)
        verificar("fala sem vivência: silêncio sem chamar o juiz", not d.cartoes and d.motivo_silencio == "fala sem vivência do paciente")
        d = decisao.decidir(con, "você pensa em se matar?", [], "terapeuta", limites=limites)
        verificar("fala do terapeuta: silêncio sem chamar modelo", not d.cartoes and d.motivo_silencio == "fala do terapeuta")
        juiz_pequeno.vivencia = lambda f: 0.99
        juiz_pequeno.principal = lambda f, t: [0.5] * len(t)
        d = decisao.decidir(con, fala, [], "paciente", limites=limites)
        verificar("nota abaixo do corte: silêncio", not d.cartoes and d.motivo_silencio == "nenhum trecho com nota para cartão")
        juiz_pequeno.principal = lambda f, t: [0.97] + [0.1] * (len(t) - 1)
        d = decisao.decidir(con, fala, [], "paciente", limites=limites)
        c = d.cartoes[0] if d.cartoes else None
        verificar("nota acima do corte: um cartão", c is not None and c.canal == "geral" and len(d.cartoes) == 1)
        if c:
            verificar("cartão tem obra, autor, página e parágrafo", all([c.titulo, c.autor, c.pagina >= 1, c.paragrafo >= 1]))
            verificar("citação do cartão existe no trecho", juiz.citacao_confere(c.citacao_literal, c.texto))
            verificar("trecho do cartão confere com a página do PDF", busca._proveniencia_ok(c.arquivo, c.pagina, c.texto))
    finally:
        juiz_pequeno.vivencia, juiz_pequeno.principal = originais


def teste_filtro(con) -> None:
    print("\n5. a seleção de obras restringe os candidatos")
    obra = con.execute("select id from obra where status='pronto' limit 1").fetchone()["id"]
    achados = busca.candidatos_amplos(con, "ansiedade e medo constante", 20, [obra])
    verificar("todos os candidatos são da obra selecionada", bool(achados) and all(c.obra_id == obra for c in achados), f"{len(achados)}")
    verificar("obra inexistente: nenhum candidato", busca.candidatos_amplos(con, "ansiedade", 20, ["nao-existe"]) == [])


def teste_api() -> None:
    print("\n6. contrato da API")
    from fastapi.testclient import TestClient

    from copiloto import pesquisa

    cliente = TestClient(pesquisa.app)
    saude = cliente.get("/api/saude").json()
    verificar("/api/saude diz juiz e modelo", {"juiz_modelo", "modelo", "trechos_no_indice"} <= set(saude))
    r = cliente.post("/api/consultar", json={"frase": "você tem pensado em se matar?", "falante": "terapeuta"}).json()
    verificar("terapeuta pela API: sem cartão", not r["cartoes"] and r["motivo_silencio"] == "fala do terapeuta")
    verificar("campo desconhecido: 422", cliente.post("/api/consultar", json={"frase": "x", "idioma": "fr"}).status_code == 422)
    verificar("frase vazia: 422", cliente.post("/api/consultar", json={"frase": ""}).status_code == 422)
    verificar("candidatos internos não saem na API", "candidatos" not in r)


def teste_filtro_prosa() -> None:
    print("\n8. filtro de prosa na ingestão")
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
    embedder.carregar()
    print(f"acervo: {len(busca.INDICE.ids)} trechos, modelo {embedder.PADRAO}")
    teste_parse(con)
    teste_proveniencia(con)
    teste_recall_candidatos(con)
    teste_decisao(con)
    teste_filtro(con)
    teste_api()
    teste_filtro_prosa()
    print("\n" + "-" * 60)
    if falhas:
        print(f"{len(falhas)} FALHA(S): " + "; ".join(falhas))
        return 1
    print("todos os contratos passaram")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
