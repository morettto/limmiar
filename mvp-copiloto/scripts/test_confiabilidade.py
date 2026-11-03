"""Regressões de contexto, respostas do juiz e proveniência, sem carregar modelos."""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from copiloto import busca, decisao, juiz, juiz_pequeno, parse, risco
from copiloto.esquema import Citacao

TEXTO = "O evitamento de lugares associados ao trauma limita a vida cotidiana e restringe as relações sociais."
CANDIDATO = Citacao("t1", "o1", "fonte.pdf", "Fonte", "Autor", "pt-BR", 1, 1, TEXTO, 0.9, "nao_verificada", 0.1)
CONTA = "10000000-0000-0000-0000-000000000000"


def receber(resposta) -> list[dict]:
    async def ler():
        return [json.loads(linha) async for linha in resposta.body_iterator]
    return asyncio.run(ler())


@patch("copiloto.acervo_profissional.materiais_autorizados", return_value={})
class ApiQualificada(unittest.TestCase):
    def qualificada(self):
        from copiloto import api
        return (patch.object(api.metadados, "estado_arquivos", return_value=api.ESTADO_INICIAL),
                patch.object(api.qualificacao, "qualificado", return_value=True))

    def test_recusa_sem_limiar_registrado_e_responde_numa_linha_so(self, _authorized):
        from copiloto import api
        from fastapi import HTTPException

        corpo = api.CorpoConsulta(frase="fala sintética", accountId=CONTA, materialIds=[])
        with patch.object(api.qualificacao, "qualificado", return_value=False), patch.object(api.decisao, "decidir") as decidir:
            with self.assertRaises(HTTPException) as erro:
                api.consultar_qualificado(corpo)
            self.assertEqual(erro.exception.status_code, 503)
            decidir.assert_not_called()
        estado, qualificado = self.qualificada()
        with estado, qualificado, \
             patch.object(api.decisao, "decidir", return_value=decisao.Decisao([], False, False, "geral", None)) as decidir:
            resposta = api.consultar_qualificado(corpo)
            dados = receber(resposta)
        self.assertEqual(len(dados), 1)
        self.assertIs(dados[0]["completo"], True)
        self.assertNotIn("cursor", dados[0])
        self.assertNotIn("candidatos", dados[0])
        self.assertEqual((resposta.media_type, resposta.headers["Cache-Control"]), ("application/x-ndjson", "no-store"))
        decidir.assert_called_once()

    def test_falha_do_juiz_vira_erro_numa_linha(self, _authorized):
        from copiloto import api

        corpo = api.CorpoConsulta(frase="fala sintética", accountId=CONTA, materialIds=[])
        for falha in (RuntimeError("falha sintética"), ValueError("notas a menos")):
            estado, qualificado = self.qualificada()
            with estado, qualificado, patch.object(api.decisao, "decidir", side_effect=falha):
                dados = receber(api.consultar_qualificado(corpo))
            self.assertEqual(dados, [{"erro": "insight.indisponivel", "juiz": api.juiz_pequeno.VERSAO}], falha)

    def test_qualificacao_cai_se_artefatos_mudam_antes_ou_durante_a_consulta(self, _authorized):
        from copiloto import api
        from fastapi import HTTPException

        _, qualificado = self.qualificada()
        with qualificado, patch.object(api.metadados, "estado_arquivos", return_value={"pdf": "mudou"}):
            self.assertIsNotNone(api._motivo())
            with self.assertRaises(HTTPException):
                api.consultar_qualificado(api.CorpoConsulta(frase="fala"))
        _, qualificado = self.qualificada()
        with qualificado, patch.object(api.metadados, "estado_arquivos", side_effect=OSError("arquivo removido")):
            self.assertIsNotNone(api._motivo())
        with patch.object(api, "_motivo", side_effect=[None, None, "mudou"]), \
             patch.object(api.decisao, "decidir", return_value=decisao.Decisao([], False, False, "geral", None)):
            dados = receber(api.consultar_qualificado(api.CorpoConsulta(frase="fala", accountId=CONTA, materialIds=[])))
        self.assertEqual(dados, [{"erro": "insight.indisponivel", "juiz": api.juiz_pequeno.VERSAO}])


class Confiabilidade(unittest.TestCase):
    def test_api_acervo_vazio_e_limite_do_modelo(self):
        from copiloto import pesquisa
        from fastapi import HTTPException
        from pydantic import ValidationError

        corpo = pesquisa.CorpoPesquisa(frase="fala")
        with patch.object(busca.INDICE, "vazio", return_value=True):
            resultado = pesquisa.consultar(corpo)
        self.assertEqual(resultado["cartoes"], [])
        self.assertNotIn("cartao", resultado)
        with patch.object(busca.INDICE, "vazio", return_value=False), \
             patch.object(decisao, "decidir", side_effect=ValueError("excedem a capacidade")):
            with self.assertRaises(HTTPException) as erro:
                pesquisa.consultar(corpo)
        self.assertEqual(erro.exception.status_code, 422)
        with self.assertRaises(ValidationError):
            pesquisa.CorpoPesquisa(frase="fala", accountId=CONTA)

    def test_busca_e_juiz_recebem_so_a_fala_e_o_contexto_vai_ao_cartao(self):
        fala, contexto = "Ainda não consigo passar por lá sozinha.", ["Fui assaltada naquela rua."]
        outro = Citacao("t2", "o2", "outra.pdf", "Outra", "Autor", "pt-BR", 1, 1, TEXTO + " Outro.", 0.9, "nao_verificada", 0.1)
        limites = {"vivencia": 0.5, "generico": 0.5, "principal": 0.9}
        with patch.object(juiz_pequeno, "vivencia", return_value=0.99) as vivencia, \
             patch.object(juiz_pequeno, "principal", side_effect=[[0.99, 0.01], [0.5]]) as principal, \
             patch.object(busca, "candidatos_amplos", return_value=[CANDIDATO, outro]) as buscar, \
             patch.object(busca, "_proveniencia_ok", return_value=True), patch.object(risco, "alerta", return_value=False):
            resultado = decisao.decidir(None, fala, contexto, limites=limites)
        self.assertEqual(buscar.call_args.args[1], fala)
        self.assertEqual(vivencia.call_args.args, (fala,))
        self.assertEqual({c.args[0] for c in principal.call_args_list}, {fala})
        self.assertTrue(resultado.cartoes)
        self.assertEqual(resultado.cartoes[0].contexto_paciente, contexto)

    def test_citacao_literal_nao_normaliza_palavras(self):
        self.assertTrue(juiz.citacao_confere(TEXTO, TEXTO))
        self.assertFalse(juiz.citacao_confere(TEXTO.lower(), TEXTO))
        self.assertFalse(juiz.citacao_confere(TEXTO.replace(".", "!"), TEXTO))
        self.assertFalse(juiz.citacao_confere("O evitamento", TEXTO))

    def test_proveniencia_confere_trecho_inteiro(self):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = Path(pasta) / "fonte.pdf"
            caminho.write_bytes(b"pdf")
            with patch.object(busca, "DIR_PDFS", Path(pasta)), \
                 patch.object(parse, "texto_da_pagina", return_value=TEXTO):
                self.assertTrue(busca._proveniencia_ok("fonte.pdf", 1, TEXTO))
                self.assertFalse(busca._proveniencia_ok("fonte.pdf", 1, TEXTO + " Esta parte foi inventada."))
                self.assertFalse(busca._proveniencia_ok("fonte.pdf", 1, ""))

    def test_cache_da_pagina_nao_reutiliza_pdf_trocado(self):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = Path(pasta) / "fonte.pdf"
            caminho.write_bytes(b"primeiro")
            pagina = unittest.mock.Mock()
            pagina.extract_text.side_effect = ["texto original", "texto substituido"]
            leitor = unittest.mock.Mock(pages=[pagina])
            with patch.object(parse, "PdfReader", return_value=leitor) as abrir:
                self.assertEqual(parse.texto_da_pagina(caminho, 1), "texto original")
                self.assertEqual(parse.texto_da_pagina(caminho, 1), "texto original")
                caminho.write_bytes(b"segundo arquivo maior")
                self.assertEqual(parse.texto_da_pagina(caminho, 1), "texto substituido")
                self.assertEqual(abrir.call_count, 2)

    def test_falante_desconhecido_nao_chega_ao_modelo(self):
        with patch.object(juiz_pequeno, "vivencia", side_effect=AssertionError("modelo chamado")):
            resultado = decisao.decidir(None, "quero morrer", falante="desconhecido")
        self.assertEqual(resultado.cartoes, [])
        self.assertEqual(resultado.motivo_silencio, "falante não identificado")

    def test_selecao_vazia_nao_abre_acervo_inteiro(self):
        indice = busca.Indice()
        indice.ids = ["t1"]
        indice.obras = np.array(["o1"])
        indice.matriz = np.ones((1, 2), dtype=np.float32)
        self.assertEqual(indice.buscar(np.ones(2), 1, []), [])
        with patch.object(busca, "INDICE", indice):
            self.assertEqual(busca.candidatos_amplos(None, "fala", obras_ids=[]), [])

    def test_api_valida_limites_e_papel_desconhecido(self):
        from pydantic import ValidationError
        from copiloto.api import CorpoConsulta

        self.assertEqual(CorpoConsulta(frase="fala", falante="desconhecido").falante, "desconhecido")
        for dados in [{"frase": "   "}, {"frase": "fala", "contexto": ["x" * 2001]},
                      {"frase": "fala", "contexto": ["a"] * 6}]:
            with self.subTest(dados=dados), self.assertRaises(ValidationError):
                CorpoConsulta(**dados)


if __name__ == "__main__":
    unittest.main()
