"""Regressões de contexto, respostas do juiz e proveniência, sem carregar modelos."""

from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from copiloto import avaliacao, busca, decisao, frase, juiz, parse, portao, treinado
from copiloto.esquema import Citacao

TEXTO = "O evitamento de lugares associados ao trauma limita a vida cotidiana e restringe as relações sociais."
CANDIDATO = Citacao("t1", "o1", "fonte.pdf", "Fonte", "Autor", "pt-BR", 1, 1, TEXTO, 0.9, "nao_verificada")


class Confiabilidade(unittest.TestCase):
    def test_fonte_alternativa_sem_revisao_nao_e_negativo_de_treino(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import treinar

        linhas = [{"id": "p00-0", "fala": "fala", "arquivo": "fonte.pdf", "pagina": 1,
                   "paragrafo": 1, "trecho": TEXTO, "alvo": 0.0}]
        with patch.object(treinar, "ler_jsonl", return_value=linhas), patch.object(treinar, "fontes_dev_revisadas", return_value={}):
            sem_revisao = treinar.pares_claude()
        self.assertEqual(treinar.rotulos_revisados(sem_revisao), [])
        linhas[0]["tipo"] = "neg"
        with patch.object(treinar, "ler_jsonl", return_value=linhas), patch.object(treinar, "fontes_dev_revisadas", return_value={}):
            negativo = treinar.pares_claude()
        selecionados = treinar.rotulos_revisados(negativo)
        self.assertEqual(len(selecionados), 2)
        self.assertTrue(all(p["alvo"] == 0.0 for p in selecionados))
        self.assertTrue(all(p["grupo"] == "p00" for p in selecionados))
        for id_ in ("p00-0", "p00-1", "p00-n"):
            self.assertEqual(treinar.grupo_da_fala(id_), "p00")
        self.assertEqual(treinar.grupo_da_fala("dev-pos-0001"), "dev-pos-0001")

    def test_contexto_e_revisoes_preservam_rotulo_e_grupo(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import treinar

        pares = [{"id": "ctx-dev-pos-0001-terceiro", "origem": "contexto-dev", "alvo": 0.0},
                 {"id": "dev-pos-0001", "origem": "caso", "alvo": 1.0},
                 {"id": "dev-pos-0001", "origem": "adjudicacao", "alvo": 0.0},
                 {"id": "dev-pos-0001", "origem": "jev", "alvo": .8}]
        selecionados = treinar.rotulos_revisados(pares)
        self.assertEqual([p["alvo"] for p in selecionados], [0.0, 1.0, 0.0])
        self.assertTrue(all(p["grupo"] == "dev-pos-0001" for p in selecionados))
        self.assertEqual(len(set(p["parte"] for p in selecionados)), 1)

    def test_treino_contextual_exclui_rotulos_soft_e_nao_retoma_resultado_obsoleto(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import treinar

        base = {"id": "c1", "arquivo": "fonte.pdf", "pagina": 1, "paragrafo": 1,
                "q": "fala", "trecho": TEXTO, "tipo": "positivo", "alvo": 1.0, "parte": 1, "origem": "claude"}
        pares = [base, {**base, "id": "soft", "origem": "jev"},
                 {**base, "id": "contexto", "origem": "contexto-dev", "alvo": 0.0},
               {**base, "id": "fonte-incorreta", "origem": "fonte-dev", "alvo": 0.0},
               {**base, "id": "validacao", "parte": 0}]
        with tempfile.TemporaryDirectory() as pasta, \
             patch.object(treinar, "TREINO", Path(pasta)), \
             patch.object(treinar, "MODELOS", Path(pasta) / "modelos"), \
             patch.object(treinar, "conjunto_dev", return_value=(pares, [])), \
             patch.object(treinar, "_treinar_um", return_value=(None, None)) as treinar_modelo, \
             patch.object(treinar, "_pontuar", return_value=[[0.9]]), \
             patch.object(treinar, "metricas_oof"):
            treinar.treinar("gte-contexto", final=False, partes=[0])
            self.assertEqual([p["id"] for p in treinar_modelo.call_args.args[1]], ["c1", "contexto", "fonte-incorreta"])
            manifesto = json.loads((Path(pasta) / "oof-gte-contexto.versao.json").read_text())
            self.assertIn("pares_sha256", manifesto)
            base["q"] = "texto alterado"
            treinar_modelo.reset_mock()
            with self.assertRaisesRegex(ValueError, "obsoletos"):
                treinar.treinar("gte-contexto", final=False, partes=[0])
            treinar_modelo.assert_not_called()

    def test_treino_preserva_contexto_passagem_e_adjudicacao_exata(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import treinar

        texto = "passagem completa " * 90
        contexto = ["Eu estava descrevendo um relato de outra pessoa."]
        p = {"id": "c1", "grupo": "c1", "fala": "Foi ela quem disse isso", "contexto": contexto,
             "trecho": texto, "arquivo": "fonte.pdf", "pagina": 1, "paragrafo": 2,
             "alvo": 0.0, "valido": False, "justificativa": "Relato de terceiro"}
        with patch.object(treinar, "ler_jsonl", return_value=[p]), patch.object(treinar, "fontes_dev_revisadas", return_value={}):
            self.assertEqual(treinar.pares_claude()[0]["q"], treinado.consulta(p["fala"], contexto))
            self.assertEqual(treinar.pares_claude()[0]["trecho"], texto)
            self.assertEqual(treinar.pares_contexto()[0]["trecho"], texto)
            self.assertEqual(treinar.pares_contexto()[0]["alvo"], 0.0)
            self.assertEqual(treinar.pares_contexto()[0]["parte"], treinar.parte("c1"))
            p["valido"] = "false"
            with self.assertRaisesRegex(ValueError, "booleano estrito"):
                treinar.pares_contexto()
            with self.assertRaisesRegex(ValueError, "booleano estrito"):
                treinar.adjudicacoes()
        p["valido"] = False
        review = {"id": "c1", "arquivo": "fonte.pdf", "pagina": 1, "trecho_aprovado": texto}
        with patch.object(treinar, "ler_jsonl", return_value=[review]), \
             patch.object(treinar, "adjudicacoes", return_value={("c1", "fonte.pdf", 1): False}):
            self.assertEqual(treinar.adjudicacoes_de_passagem(), {("c1", "fonte.pdf", 1, texto): False})
        caso = {"id": "c1", "tipo": "positivo", "fala": p["fala"], "contexto": contexto, "canal": "geral", "falante": "paciente"}
        candidatos = [{**p, "paragrafo": n} for n in (2, 3)] + [{**p, "trecho": "outra passagem", "paragrafo": 4}]
        with patch.object(treinar, "pares_dev", return_value={"c1": candidatos}), \
             patch.object(treinar, "cache_jev", return_value={}), \
             patch.object(treinar, "adjudicacoes_de_passagem", return_value={("c1", "fonte.pdf", 1, texto): True}), \
             patch.object(treinar, "casos", return_value=[caso]), \
             patch.object(treinar, "ler_jsonl", return_value=[]), \
             patch.object(treinar, "conjunto_aug", return_value=([], [])), \
             patch.object(treinar, "pares_claude", return_value=[]), \
             patch.object(treinar, "passagens_prova", return_value=set()):
            pares, _ = treinar.conjunto_dev()
        self.assertEqual([x["paragrafo"] for x in pares], [2, 3])
        self.assertEqual([x["alvo"] for x in pares], [1.0, 1.0])
        self.assertTrue(all(x["trecho"] == texto for x in pares))

    def test_treino_nao_trunca_e_atualiza_ultima_acumulacao(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import treinar
        import torch
        from unittest.mock import Mock

        class Enc(dict):
            def to(self, dispositivo):
                return self

        tok = Mock()
        tok.pad_token = "pad"
        tok.pad_token_id = 0
        tok.side_effect = lambda a, *b, **kw: Enc(input_ids=torch.ones((len(a), 600)))
        fatia = [{"q": "contexto inteiro", "trecho": "texto inteiro", "alvo": 1.0}] * 5
        self.assertEqual(treinar._codificar(tok, fatia, True, 8192)["input_ids"].shape, (5, 600))
        self.assertIs(tok.call_args.kwargs["truncation"], False)
        self.assertNotIn("max_length", tok.call_args.kwargs)
        with self.assertRaisesRegex(ValueError, "sem truncá-la"):
            treinar._codificar(tok, fatia, True, 512)

        class Modelo(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.peso = torch.nn.Parameter(torch.tensor(0.1))
                self.config = SimpleNamespace(max_position_embeddings=8192)
                self.lotes = []
            def forward(self, input_ids):
                self.lotes.append(len(input_ids))
                return SimpleNamespace(logits=self.peso.expand(len(input_ids), 1))

        modelo = Modelo()
        agenda = Mock()
        fabrica_agenda = Mock(return_value=agenda)
        transformers = SimpleNamespace(AutoModelForSequenceClassification=SimpleNamespace(from_pretrained=lambda *a, **k: modelo),
                                       AutoTokenizer=SimpleNamespace(from_pretrained=lambda *a, **k: tok),
                                       get_linear_schedule_with_warmup=fabrica_agenda)
        cfg = {"hf": "falso", "lr": .01, "lote": 2, "acumular": 2, "epocas": 2}
        with patch.dict(sys.modules, {"transformers": transformers}), \
             patch.object(treinar, "reparar"), patch.object(treinar, "_dispositivo", return_value="cpu"):
            treinar._treinar_um(cfg, fatia, ("alvo",), None)
        self.assertEqual(modelo.lotes, [2, 2, 1, 2, 2, 1])
        self.assertEqual(fabrica_agenda.call_args.args[-1], 4)
        self.assertEqual(agenda.step.call_count, 4)
        self.assertGreater(modelo.peso.item(), .1)

    def test_juiz_preserva_textos_completos_e_limita_lotes_longos(self):
        import torch
        from unittest.mock import Mock

        fala, contexto = "palavra " * 250, ["contexto " * 250]
        trechos = ["trecho " * 200 + str(i) for i in range(5)]
        tok = Mock(return_value={"input_ids": [list(range(600)) for _ in trechos]})
        tok.pad.side_effect = lambda dados, **kwargs: SimpleNamespace(
            to=lambda dispositivo: {"input_ids": torch.tensor(dados["input_ids"])})
        modelo = Mock(device="cpu", config=SimpleNamespace(max_position_embeddings=8192))
        modelo.side_effect = lambda **dados: SimpleNamespace(logits=torch.zeros(len(dados["input_ids"]), 1))
        with patch.object(treinado, "_carregar", return_value=(tok, modelo)):
            self.assertEqual(treinado.julgar(fala, contexto, trechos), [0.5] * 5)
            self.assertEqual(tok.call_args.args, ([treinado.consulta(fala, contexto)] * 5, trechos))
            self.assertIs(tok.call_args.kwargs["truncation"], False)
            self.assertEqual([len(c.kwargs["input_ids"]) for c in modelo.call_args_list], [1] * 5)
            modelo.reset_mock()
            tok.return_value = {"input_ids": [list(range(200)) for _ in trechos]}
            treinado.julgar(fala, contexto, trechos)
            self.assertEqual([len(c.kwargs["input_ids"]) for c in modelo.call_args_list], [4, 1])
            modelo.reset_mock()
            tok.return_value = {"input_ids": [list(range(8193)) for _ in trechos]}
            with self.assertRaisesRegex(ValueError, "excedem a capacidade"):
                treinado.julgar(fala, contexto, trechos)
            modelo.assert_not_called()
        self.assertEqual(treinado.julgar(fala, contexto, []), [])

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
            pesquisa.CorpoPesquisa(frase="fala", accountId="10000000-0000-0000-0000-000000000000")

    @patch("copiloto.acervo_profissional.materiais_autorizados", return_value={})
    def test_api_qualificada_recusa_modelo_sem_prova_e_delega_somente_apos_aprovacao(self, _authorized):
        import asyncio
        from copiloto import api
        from fastapi import HTTPException

        corpo = api.CorpoConsulta(frase="fala sintética", falante="paciente", accountId="10000000-0000-0000-0000-000000000000", materialIds=[])
        with patch.object(api.qualificacao, "qualificado", return_value=False), \
             patch.object(api.decisao, "decidir_progressivamente") as consultar:
            with self.assertRaises(HTTPException) as erro:
                api.consultar_qualificado(corpo)
            self.assertEqual(erro.exception.status_code, 503)
            consultar.assert_not_called()
        with patch.object(api.juiz_llm, "URL", "http://juiz"), \
             patch.object(api.qualificacao, "qualificado", return_value=True), \
             patch.object(api.decisao, "decidir_progressivamente", side_effect=[iter([
                 decisao.Decisao([], False, False, "geral", None, completo=False, fontes_avaliadas=8)]), iter([
                 decisao.Decisao([], False, False, "geral", None, fontes_avaliadas=16)])]) as consultar:
            resposta = api.consultar_qualificado(corpo)
            async def receber():
                return [json.loads(dados) async for dados in resposta.body_iterator]
            dados = asyncio.run(receber())
            self.assertEqual([d["completo"] for d in dados], [False])
            self.assertEqual(resposta.media_type, "application/x-ndjson")
            self.assertEqual(resposta.headers["Cache-Control"], "no-store")
            self.assertTrue(all("candidatos" not in d for d in dados))
            consultar.assert_called_once()
            self.assertTrue(consultar.call_args.args[-2]())
            resposta = api.consultar_qualificado(corpo.model_copy(update={"cursor": dados[0]["cursor"]}))
            dados = asyncio.run(receber())
            self.assertTrue(dados[0]["completo"])
            self.assertNotIn("cursor", dados[0])
            self.assertEqual(consultar.call_args.args[-1], 8)
            self.assertEqual(consultar.call_count, 2)

    @patch("copiloto.acervo_profissional.materiais_autorizados", return_value={})
    def test_api_recusa_cursor_adulterado_ou_de_outra_fala_antes_da_inferencia(self, _authorized):
        from copiloto import api, continuacao
        from fastapi import HTTPException
        corpo = api.CorpoConsulta(frase="Paciente sintético", accountId="10000000-0000-0000-0000-000000000000", materialIds=[])
        vinculo = {"consulta": corpo.model_dump(mode="json", exclude={"cursor"}), "versao": api.VERSAO, "limiares": decisao.limiares(), "acervo": []}
        cursor = continuacao.emitir(8, vinculo)
        with patch.object(api, "_qualificado", return_value=True), \
             patch.object(decisao, "decidir_progressivamente") as julgar:
            for consulta in (corpo.model_copy(update={"cursor": "!" * 48}),
                             corpo.model_copy(update={"cursor": cursor, "frase": "Texto corrigido"})):
                with self.assertRaises(HTTPException) as erro:
                    api.consultar_qualificado(consulta)
                self.assertEqual(erro.exception.status_code, 422)
            julgar.assert_not_called()

    @patch("copiloto.acervo_profissional.materiais_autorizados", return_value={})
    def test_qualificacao_cai_se_artefatos_mudam_antes_ou_durante_o_stream(self, _authorized):
        import asyncio
        from copiloto import api
        from fastapi import HTTPException

        with patch.object(api.juiz_llm, "URL", "http://juiz"), \
             patch.object(api.metadados, "estado_arquivos", return_value={"pdf": "mudou"}), \
             patch.object(api.qualificacao, "qualificado", return_value=True):
            self.assertFalse(api._qualificado())
            with self.assertRaises(HTTPException):
                api.consultar_qualificado(api.CorpoConsulta(frase="fala"))
        with patch.object(api.metadados, "estado_arquivos", side_effect=OSError("arquivo removido")):
            self.assertFalse(api._qualificado())
        with patch.object(api, "_qualificado", side_effect=[True, True, False]), \
             patch.object(api.decisao, "decidir_progressivamente", return_value=iter([
                 decisao.Decisao([], False, False, "geral", None, completo=False),
                 decisao.Decisao([], False, False, "geral", None)])):
            resposta = api.consultar_qualificado(api.CorpoConsulta(frase="fala", accountId="10000000-0000-0000-0000-000000000000", materialIds=[]))
            async def receber():
                return [json.loads(dados) async for dados in resposta.body_iterator]
            dados = asyncio.run(receber())
        self.assertEqual(dados, [{"erro": "insight.indisponivel", "juiz": api.juiz_llm.VERSAO}])

    def test_fontes_sao_entregues_por_lotes_sem_corte_por_obra(self):
        candidatos = [replace(CANDIDATO, trecho_id=f"t{i}", obra_id=f"o{i % 5}") for i in range(19)]
        with patch.object(treinado, "triar", return_value={"clinica": .99, "risco": 0, "ambigua": 0}), \
             patch.object(busca, "candidatos_amplos", return_value=candidatos) as buscar, \
             patch.object(treinado, "julgar", side_effect=lambda f, c, textos: [.99] * len(textos)) as julgar, \
             patch.object(juiz, "frases_mais_proximas", side_effect=lambda f, textos, v: [TEXTO] * len(textos)), \
             patch("copiloto.embedder.codificar_consultas", return_value=np.array([[1.0]])), \
             patch.object(busca, "_proveniencia_ok", return_value=True):
            stream = decisao.decidir_progressivamente(None, "fala", [], "paciente", "pt-BR", None, decisao.LIMIARES_PADRAO)
            primeiro = next(stream)
            self.assertEqual(len(primeiro.cartoes), 8)
            self.assertFalse(primeiro.completo)
            self.assertEqual(julgar.call_count, 1)
            restantes = list(stream)
            self.assertEqual(len(restantes[-1].cartoes), 19)
            self.assertTrue(restantes[-1].completo)
            self.assertEqual(julgar.call_count, 3)
            self.assertEqual(buscar.call_args.kwargs, {"obras_ids": None, "indice": None})

    def test_continuacao_avalia_so_fontes_restantes_e_recusa_posicao_fora_do_acervo(self):
        candidatos = [replace(CANDIDATO, trecho_id=f"t{i}", obra_id=f"o{i % 5}") for i in range(19)]
        with patch.object(treinado, "triar", return_value={"clinica": .99, "risco": 0, "ambigua": 0}), \
             patch.object(busca, "candidatos_amplos", return_value=candidatos), \
             patch.object(treinado, "julgar", side_effect=lambda f, c, textos: [.99] * len(textos)) as julgar, \
             patch.object(juiz, "frases_mais_proximas", side_effect=lambda f, textos, v: [TEXTO] * len(textos)), \
             patch("copiloto.embedder.codificar_consultas", return_value=np.array([[1.0]])), \
             patch.object(busca, "_proveniencia_ok", return_value=True):
            stream = list(decisao.decidir_progressivamente(None, "fala", [], "paciente", "pt-BR", None,
                          decisao.LIMIARES_PADRAO, inicio_fonte=8))
            self.assertEqual({c.trecho_id for c in stream[0].cartoes}, {f"t{i}" for i in range(8, 16)})
            self.assertEqual([r.fontes_avaliadas for r in stream], [16, 19])
            self.assertEqual(len(stream[-1].cartoes), 11)
            self.assertEqual(julgar.call_count, 2)
            for posicao in (-1, True, 19):
                with self.assertRaisesRegex(ValueError, "Posição"):
                    list(decisao.decidir_progressivamente(None, "fala", [], "paciente", "pt-BR", None,
                         decisao.LIMIARES_PADRAO, inicio_fonte=posicao))

    def test_cancelamento_para_antes_de_avaliar_o_proximo_lote(self):
        with patch.object(treinado, "triar", return_value={"clinica": .99, "risco": 0, "ambigua": 0}), \
             patch.object(busca, "candidatos_amplos", return_value=[CANDIDATO]), \
             patch.object(treinado, "julgar") as julgar:
            self.assertEqual(list(decisao.decidir_progressivamente(None, "fala", [], "paciente", "pt-BR", None,
                                                                 decisao.LIMIARES_PADRAO, lambda: True)), [])
            julgar.assert_not_called()

    def test_regua_classica_conta_todas_as_referencias_e_exige_passagem(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import avaliar
        caso = {"id": "c1", "fala": "Evito aquela rua", "contexto": ["Fui assaltada"],
                "fenomeno": "evitamento", "tipo": "positivo", "canal": "geral",
                "alvos": [{"arquivo": "fonte.pdf", "pagina": 1}],
                "fonte": {"arquivo": "fonte.pdf", "pagina": 1, "paragrafo": 1}}
        d = {"cartoes": [{"trecho_id": "t1", "arquivo": "fonte.pdf", "pagina": 1, "paragrafo": 1, "probabilidade": .99},
                          {"trecho_id": "t2", "arquivo": "fonte.pdf", "pagina": 1, "paragrafo": 2, "probabilidade": .98}],
             "triagem": {"valida": True, "probabilidades": {"clinica": .99, "risco": .01, "ambigua": .01}}}
        r = avaliar.resumo([{"id": "c1", "decisao": d}], [caso], decisao.LIMIARES_PADRAO, {})
        self.assertEqual(r["cartoes_mostrados"], 2)
        self.assertEqual(r["cartoes_por_adjudicar"], 1)
        self.assertEqual(r["cobertura_geral"], 1)
        self.assertIsNone(r["precisao"])
        r = avaliar.resumo([{"id": "c1", "decisao": d}], [caso], decisao.LIMIARES_PADRAO,
                           {("c1", "fonte.pdf", 1, 2): True})
        self.assertEqual(r["precisao"], 1)
        self.assertEqual(r["cobertura_geral"], 1)

    def test_avaliacao_aceita_fontes_equivalentes_e_separa_pendencias(self):
        import hashlib
        caso = {"id": "fala1", "fala": "Evito a rua após o assalto", "contexto": [],
                "idioma": "pt-BR", "esperados": ["gabarito"]}
        cartoes = [{"trecho_id": f"artigo-ou-livro-{i}", "texto": TEXTO} for i in range(7)]
        revisoes = [{"caso_sha256": avaliacao.hash_caso(caso), "trecho_id": c["trecho_id"],
                     "trecho_sha256": hashlib.sha256(TEXTO.encode()).hexdigest(), "valido": i < 5,
                     "justificativa": "Sustenta evitamento após trauma" if i < 5 else "Contexto incompatível"}
                    for i, c in enumerate(cartoes[:6])]
        registos = [{"id": "fala1", "decisao": {"cartoes": cartoes}}]
        metricas = avaliacao.avaliar_referencias([caso], registos, revisoes)
        self.assertEqual((metricas["references_valid"], metricas["references_invalid"], metricas["references_pending"]), (5, 1, 1))
        self.assertEqual(metricas["coverage_positive_verified"], 1)
        self.assertIsNone(metricas["semantic_precision"])
        with self.assertRaises(ValueError):
            avaliacao.avaliar_referencias([caso], registos, [{**revisoes[0], "valido": "false"}])
        mudou_contexto = {**caso, "contexto": ["Na verdade foi minha irmã, eu não evito aquela rua"]}
        self.assertEqual(avaliacao.avaliar_referencias([mudou_contexto], registos, revisoes)["references_pending"], 7)

    def test_retorna_todas_as_fontes_aprovadas_sem_duplicar(self):
        candidatos = [replace(CANDIDATO, trecho_id=f"t{i}", obra_id=f"o{i}", titulo=f"Fonte {i}")
                      for i in range(7)]
        avaliacoes = [juiz.Avaliacao(c.trecho_id, True, 0.99 - i / 100, "evitamento após trauma",
                                   "evitamento após trauma", TEXTO, True)
                     for i, c in enumerate(candidatos)]
        avaliacoes[5] = replace(avaliacoes[5], corresponde=False)
        candidatos.append(candidatos[0])
        with patch.object(busca, "_proveniencia_ok", side_effect=lambda arquivo, pagina, texto: arquivo != "trocado.pdf"):
            candidatos[6] = replace(candidatos[6], arquivo="trocado.pdf")
            resultado = decisao._escolher(avaliacoes, candidatos, list(range(len(candidatos))),
                                         [{"trecho_id": c.trecho_id} for c in candidatos],
                                         False, "geral", "Evito aquela rua", ["Fui assaltada lá"],
                                         decisao.LIMIARES_PADRAO, {}, {})
        self.assertEqual([c.trecho_id for c in resultado.cartoes], [f"t{i}" for i in range(5)])
        self.assertEqual(len({c.obra_id for c in resultado.cartoes}), 5)
        self.assertEqual(len(resultado.para_json()["cartoes"]), 5)
        self.assertNotIn("cartao", resultado.para_json())

    def test_citacao_preserva_frase_inteira(self):
        frase = "O paciente descreve " + "uma experiência persistente de sofrimento " * 10 + "."
        with patch("copiloto.embedder.codificar_documentos", return_value=np.array([[1.0]])), \
             patch("copiloto.embedder.codificar_consultas", return_value=np.array([[1.0]])):
            self.assertEqual(juiz.frase_mais_proxima("sofrimento", frase), frase)
        self.assertEqual(juiz.frase_mais_proxima("fala", "texto curto"), "texto curto")

    def test_contexto_preservado_na_fala_longa(self):
        contexto = ["Fui ameaçada depois do acidente.", "Fui assaltada naquela rua.", "Desde então evito sair.",
                    "Meu sono também mudou.", "Ainda tenho lembranças involuntárias."]
        fala = "Ainda não consigo passar por lá sozinha."
        self.assertEqual(treinado.consulta(fala, contexto), " / ".join(contexto) + " || " + fala)
        self.assertEqual(treinado.consulta(fala, []), fala)

    def test_busca_e_citacao_recebem_contexto_do_juiz(self):
        fala, contexto = "Ainda não consigo passar por lá sozinha.", ["Fui assaltada naquela rua."]
        with patch.object(decisao, "decisor", return_value="treinado"), \
             patch.object(treinado, "formato", return_value="qwen-frase-v2"), \
             patch.object(treinado, "triar", return_value={"clinica": 0.99, "risco": 0.01, "ambigua": 0.01}), \
             patch.object(treinado, "julgar", return_value=[0.99]), \
             patch.object(busca, "candidatos_amplos", return_value=[CANDIDATO]) as buscar, \
             patch.object(busca, "_proveniencia_ok", return_value=True), \
             patch.object(juiz, "citacoes_qualificadas", return_value=[(TEXTO, .99)]) as citar, \
             patch("copiloto.embedder.codificar_consultas", return_value=np.array([[1.0]])):
            resultado = decisao.decidir(None, fala, contexto)
        self.assertEqual(buscar.call_args.args[1], frase.consulta(fala, contexto))
        self.assertEqual(citar.call_args.args[:2], (fala, contexto))
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

    def test_escolha_reconfere_evidencia_e_score(self):
        for score, citacao in [(math.nan, TEXTO), (math.inf, TEXTO), (1.1, TEXTO), (0.99, "evidencia inventada neste lugar")]:
            with self.subTest(score=score, citacao=citacao), patch.object(busca, "_proveniencia_ok", return_value=True):
                avaliacao = juiz.Avaliacao("t1", True, score, "f", "f", citacao, True)
                resultado = decisao._escolher([avaliacao], [CANDIDATO], [0], [{"trecho_id": "t1"}],
                                             False, "geral", "fala", [], decisao.LIMIARES_PADRAO, {}, {})
                self.assertEqual(resultado.cartoes, [])

    def test_juiz_nao_adivinha_ids_booleanos_ou_confianca(self):
        casos = [
            {"fenomeno_na_fala": "f", "avaliacoes": [{"id": "errado", "fenomeno_no_trecho": "f", "corresponde": True, "citacao_literal": TEXTO}]},
            {"fenomeno_na_fala": "f", "avaliacoes": [{"id": "T1", "fenomeno_no_trecho": "f", "corresponde": "false", "citacao_literal": TEXTO}]},
            {"fenomeno_na_fala": "f", "avaliacoes": [{"id": "T1", "fenomeno_no_trecho": "f", "corresponde": True, "citacao_literal": TEXTO}]},
            [],
        ]
        for dados in casos:
            with self.subTest(dados=dados), httpx.Client(transport=httpx.MockTransport(
                lambda r: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(dados)}}]})
            )) as cliente:
                avaliacoes = juiz.avaliar("fala", [], [("t1", TEXTO)], cliente)
                self.assertFalse(any(a.corresponde and a.probabilidade >= 0.9 for a in avaliacoes))

    def test_falante_desconhecido_nao_chega_ao_modelo(self):
        with patch.object(treinado, "triar", side_effect=AssertionError("modelo chamado")):
            resultado = decisao.decidir(None, "quero morrer", falante="desconhecido")
        self.assertEqual(resultado.cartoes, [])
        self.assertEqual(resultado.motivo_silencio, "falante não identificado")

    def test_portao_nao_aceita_booleanos_em_texto_ou_confianca_ausente(self):
        for clinica in (True, "false"):
            with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": [
                {"message": {"content": json.dumps({"clinica": clinica, "canal": "geral", "ambigua": False, "termos": ""})}}
            ]}))) as cliente:
                self.assertFalse(portao.triar("fala", [], cliente).valida)

    def test_selecao_vazia_nao_abre_acervo_inteiro(self):
        indice = busca.Indice()
        indice.ids = ["t1"]
        indice.obras = np.array(["o1"])
        indice.matriz = np.ones((1, 2), dtype=np.float32)
        self.assertEqual(indice.buscar(np.ones(2), 1, []), [])
        with patch.object(busca, "INDICE", indice), \
             patch.object(busca.traducao, "variantes", return_value={"pt-BR": "fala"}):
            self.assertEqual(busca.candidatos_amplos(None, "fala", "pt-BR", obras_ids=[]), [])

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
