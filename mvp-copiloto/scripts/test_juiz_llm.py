import json
import math
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from copiloto import juiz_llm

TREINO_JUIZ = Path(__file__).resolve().parents[2] / "tools" / "atendimento-simulado" / "treino-juiz"


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
        cliente = httpx.Client(transport=servidor(respostas))
        return patch.object(juiz_llm.httpx, "post", lambda url, **kw: cliente.post(url, **kw))

    def test_nota_e_a_probabilidade_de_sim_entre_sim_e_nao(self):
        respostas = lambda corpo: {"choices": [{"logprobs": {"content": [{"top_logprobs": top(0.6, 0.2)}]}}]}
        with self.com_servidor(respostas):
            self.assertAlmostEqual(juiz_llm.julgar("fala", ["trecho a", "trecho b"])[0], 0.75)

    def test_juiz_e_o_professor_com_o_trecho_inteiro_antes_da_fala_e_o_adaptador_desligado(self):
        vistos = []
        def respostas(corpo):
            vistos.append(corpo)
            return {"choices": [{"logprobs": {"content": [{"top_logprobs": top(0.5, 0.5)}]}}]}
        with self.com_servidor(respostas):
            juiz_llm.julgar("minha fala", ["x" * 3000])
        pedido = juiz_llm.pedido_juiz("x" * 3000, "minha fala")
        self.assertEqual({k: vistos[0][k] for k in pedido}, pedido)
        self.assertEqual(vistos[0]["chat_template_kwargs"], {"enable_thinking": False}, "the teacher ran with thinking off")
        mensagens = vistos[0]["messages"]
        self.assertEqual(mensagens[0], {"role": "system", "content": juiz_llm.SISTEMA_JUIZ})
        usuario = mensagens[1]["content"]
        self.assertIn('"""' + "x" * 3000 + '"""', usuario)
        self.assertLess(usuario.index("x" * 3000), usuario.index("minha fala"))
        self.assertEqual((vistos[0]["max_tokens"], vistos[0]["model"]), (1, "base"))
        self.assertEqual(vistos[0]["lora"], [{"id": 0, "scale": 0.0}])
        self.assertNotIn("cache_salt", vistos[0])

    def test_professor_do_treino_rotula_com_as_mensagens_de_producao(self):
        if not (TREINO_JUIZ / "professor.py").exists():
            self.skipTest("treino-juiz ausente")
        sys.path.insert(0, str(TREINO_JUIZ))
        import professor
        enviados = []
        with patch.object(professor, "_post", side_effect=lambda caminho, corpo, **_: enviados.append((caminho, corpo)) or {"prompt": ""}):
            professor.prompt_juiz("trecho", "fala")
        self.assertEqual(enviados, [("/apply-template", juiz_llm.pedido_juiz("trecho", "fala"))])

    def test_cache_salt_e_estavel_imprevisivel_e_isolado_por_conta(self):
        with patch.object(juiz_llm, "CHAVE", "segredo-de-teste-com-entropia-suficiente"):
            primeiro = juiz_llm.cache_salt("10000000-0000-0000-0000-000000000001")
            self.assertEqual(primeiro, juiz_llm.cache_salt("10000000-0000-0000-0000-000000000001"))
            self.assertNotEqual(primeiro, juiz_llm.cache_salt("10000000-0000-0000-0000-000000000002"))
        self.assertEqual(len(primeiro), 64)
        self.assertNotIn("10000000", primeiro)
        self.assertNotIn("segredo-de-teste", primeiro)

    def test_todas_as_chamadas_remotas_e_a_lru_de_reescrita_sao_escopadas(self):
        vistos = []
        def respostas(corpo):
            vistos.append(corpo)
            if corpo["messages"][0]["content"] == juiz_llm.REESCRITA:
                return {"choices": [{"message": {"content": "PT: Evitação.\nEN: Avoidance.\nES: Evitación."}}]}
            return {"choices": [{"logprobs": {"content": [{"top_logprobs": top(0.7, 0.3)}]}}]}

        with self.com_servidor(respostas):
            juiz_llm.julgar("fala", ["trecho"], cache_salt="conta-a")
            juiz_llm.triar("fala", [], cache_salt="conta-a")
            juiz_llm.reescrever("fala", [], cache_salt="conta-a")
            juiz_llm.reescrever("fala", [], cache_salt="conta-b")

        self.assertEqual(len(vistos), 6)
        self.assertEqual({corpo["cache_salt"] for corpo in vistos}, {"conta-a", "conta-b"})
        self.assertEqual(sum(corpo["messages"][0]["content"] == juiz_llm.REESCRITA for corpo in vistos), 2)
        self.assertEqual({json.dumps(corpo["lora"]) for corpo in vistos}, {json.dumps(juiz_llm.LORA_BASE)})
        self.assertTrue(all(corpo["chat_template_kwargs"] == {"enable_thinking": False} for corpo in vistos),
                        "pensamento ligado troca o primeiro token e esgota a reescrita")

    def test_resposta_sem_sim_nem_nao_falha_em_vez_de_inventar_nota(self):
        respostas = lambda corpo: {"choices": [{"logprobs": {"content": [{"top_logprobs": [{"token": "talvez", "logprob": -1}]}]}}]}
        with self.com_servidor(respostas), self.assertRaises(ValueError):
            juiz_llm.julgar("fala", ["trecho"])

    def test_nao_fabrica_certeza_se_classe_oposta_foi_truncada(self):
        respostas = lambda corpo: {"choices": [{"logprobs": {"content": [{"top_logprobs": [
            {"token": "yes", "logprob": math.log(0.2)}, {"token": "perhaps", "logprob": math.log(0.7)}
        ]}]}}]}
        with self.com_servidor(respostas), self.assertRaisesRegex(ValueError, "duas classes"):
            juiz_llm.julgar("fala", ["trecho"])

    def test_classe_oposta_abaixo_do_top_logprobs_vira_nota_pelo_limite(self):
        respostas = lambda corpo: {"choices": [{"logprobs": {"content": [{"top_logprobs": [
            {"token": "yes", "logprob": math.log(0.9999)}, {"token": "Yes", "logprob": math.log(0.00005)},
            {"token": "maybe", "logprob": math.log(1e-7)}
        ]}]}}]}
        with self.com_servidor(respostas):
            nota, = juiz_llm.julgar("fala", ["trecho"])
        self.assertAlmostEqual(nota, 1.0, places=5)
        self.assertLessEqual(nota, 0.99995 / (0.99995 + 1e-7) + 1e-12)

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

    def test_sem_url_nao_esta_configurado(self):
        with patch.object(juiz_llm, "URL", ""):
            self.assertFalse(juiz_llm.configurado())


if __name__ == "__main__":
    unittest.main()
