import json
import os
import tempfile
from pathlib import Path
import math
import unittest
from unittest.mock import patch

import httpx

from copiloto import decisao, juiz_llm, treinado


def servidor(respostas):
    def tratar(requisicao: httpx.Request):
        corpo = json.loads(requisicao.content)
        return httpx.Response(200, json=respostas(corpo))
    return httpx.MockTransport(tratar)


def top(sim, nao):
    return [{"token": "yes", "logprob": math.log(sim)}, {"token": " No", "logprob": math.log(nao)}, {"token": "maybe", "logprob": -9}]


class JuizLLM(unittest.TestCase):
    def setUp(self):
        self.url = patch.object(juiz_llm, "URL", "http://juiz")
        self.url.start()
        juiz_llm._reescrever.cache_clear()

    def tearDown(self):
        self.url.stop()

    def com_servidor(self, respostas):
        original = httpx.post
        cliente = httpx.Client(transport=servidor(respostas))
        return patch.object(juiz_llm.httpx, "post", lambda url, **kw: cliente.post(url, **kw))

    def test_nota_e_a_probabilidade_de_sim_entre_sim_e_nao(self):
        respostas = lambda corpo: {"choices": [{"logprobs": {"content": [{"top_logprobs": top(0.6, 0.2)}]}}]}
        with self.com_servidor(respostas):
            self.assertAlmostEqual(juiz_llm.julgar("fala", [], ["trecho a", "trecho b"])[0], 0.75)

    def test_prompt_de_producao_e_o_do_treino(self):
        vistos = []
        def respostas(corpo):
            vistos.append(corpo)
            return {"choices": [{"logprobs": {"content": [{"top_logprobs": top(0.5, 0.5)}]}}]}
        with self.com_servidor(respostas):
            juiz_llm.julgar("minha fala", ["antes"], ["x" * 3000])
        mensagens = vistos[0]["messages"]
        self.assertEqual(mensagens[0], {"role": "system", "content": juiz_llm.RUBRICA})
        self.assertIn("PREVIOUS PATIENT STATEMENTS:\n- antes\n\nCURRENT STATEMENT:\nminha fala\n\nPASSAGE:\n" + "x" * 1600 + "\n\n", mensagens[1]["content"])
        self.assertNotIn("x" * 1601, mensagens[1]["content"])
        self.assertEqual((vistos[0]["max_tokens"], vistos[0]["model"]), (1, "juiz"))
        self.assertEqual(vistos[0]["lora"], [{"id": 0, "scale": 1.0}])

    def test_resposta_sem_sim_nem_nao_falha_em_vez_de_inventar_nota(self):
        respostas = lambda corpo: {"choices": [{"logprobs": {"content": [{"top_logprobs": [{"token": "talvez", "logprob": -1}]}]}}]}
        with self.com_servidor(respostas), self.assertRaises(ValueError):
            juiz_llm.julgar("fala", [], ["trecho"])

    def test_reescrita_vira_tres_linhas_e_none_vira_vazio(self):
        texto = "PT: Evitação.\nEN: Avoidance.\nES: Evitación."
        vistos = []
        def respostas(corpo):
            vistos.append(corpo)
            return {"choices": [{"message": {"content": texto}}]}
        with self.com_servidor(respostas):
            self.assertEqual(juiz_llm.reescrever("fala", []), ["Evitação.", "Avoidance.", "Evitación."])
        self.assertEqual((vistos[0]["model"], vistos[0]["lora"]), ("base", [{"id": 0, "scale": 0.0}]))
        juiz_llm._reescrever.cache_clear()
        with self.com_servidor(lambda corpo: {"choices": [{"message": {"content": "NONE"}}]}):
            self.assertEqual(juiz_llm.reescrever("oi", []), [])

    def portao(self, probs):
        def respostas(corpo):
            sim = probs[next(r for r, p in juiz_llm.PERGUNTAS.items() if p == corpo["messages"][0]["content"])]
            return {"choices": [{"logprobs": {"content": [{"top_logprobs": top(sim, 1 - sim)}]}}]}
        return respostas

    def test_triagem_faz_tres_perguntas_ao_modelo_base(self):
        vistos = []
        base = self.portao({"clinica": 0.9, "risco": 0.1, "ambigua": 0.25})
        def respostas(corpo):
            vistos.append(corpo)
            return base(corpo)
        with self.com_servidor(respostas):
            notas = juiz_llm.triar("fala", ["antes"])
        self.assertEqual(notas.keys(), {"clinica", "risco", "ambigua"})
        self.assertAlmostEqual(notas["clinica"], 0.9)
        self.assertAlmostEqual(notas["ambigua"], 0.25)
        self.assertEqual({v["model"] for v in vistos}, {"base"})
        self.assertEqual([v["lora"] for v in vistos], [[{"id": 0, "scale": 0.0}]] * 3)
        self.assertEqual(len(vistos), 3)
        self.assertIn("- antes", vistos[0]["messages"][1]["content"])

    def test_treinado_despacha_triagem_e_nao_exige_arquivos_antigos(self):
        sem_arquivos = Path(tempfile.mkdtemp()) / "inexistente"
        with patch.object(treinado, "MODELOS", sem_arquivos), self.com_servidor(self.portao({"clinica": 0.8, "risco": 0.2, "ambigua": 0.1})), patch.dict(os.environ, {"COPILOTO_DECISOR": ""}):
            self.assertAlmostEqual(treinado.triar("fala", [])["clinica"], 0.8)
            self.assertTrue(treinado.disponivel())
            self.assertIsNone(treinado.formato(treinado.NOME_JUIZ))
            self.assertEqual(treinado.consulta_para_modelo("fala", ["a"]), treinado.consulta("fala", ["a"]))
            self.assertEqual(decisao.decisor(), "treinado")
            self.assertEqual(decisao.arquivo_limiares().name, "limiares-juiz-llm.json")
            self.assertFalse(sem_arquivos.exists())

    def test_sem_url_nao_esta_configurado(self):
        with patch.object(juiz_llm, "URL", ""):
            self.assertFalse(juiz_llm.configurado())


if __name__ == "__main__":
    unittest.main()
