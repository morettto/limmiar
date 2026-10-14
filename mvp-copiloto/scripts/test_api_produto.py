"""App de produto: só as rotas autenticadas, CORS restrito à origem do app e saúde do juiz LLM."""
import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import api, juiz_llm

APP = "https://app.exemplo"


def recarregar(**ambiente):
    with patch.dict(os.environ, ambiente):
        if "COPILOTO_APP_ORIGEM" not in ambiente:
            os.environ.pop("COPILOTO_APP_ORIGEM", None)
        return importlib.reload(api)


class RotasDoProduto(unittest.TestCase):
    def setUp(self):
        self.addCleanup(recarregar)
        self.client = TestClient(recarregar().app)

    def test_rotas_de_pesquisa_nao_existem_no_produto(self):
        for metodo, caminho in (("GET", "/"), ("GET", "/api/acervo"), ("GET", "/api/jobs/x"), ("POST", "/api/consultar")):
            self.assertEqual(self.client.request(metodo, caminho, json={"frase": "fala"}).status_code, 404, caminho)

    def test_sem_variavel_nao_ha_cors(self):
        resposta = self.client.get("/api/saude", headers={"Origin": APP})
        self.assertNotIn("access-control-allow-origin", resposta.headers)

    def test_cors_so_para_a_origem_do_app(self):
        client = TestClient(recarregar(COPILOTO_APP_ORIGEM=APP).app)
        pedido = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
        permitido = client.options("/api/consultar-qualificado", headers={"Origin": APP, **pedido})
        self.assertEqual(permitido.status_code, 200)
        self.assertEqual(permitido.headers["access-control-allow-origin"], APP)
        self.assertNotIn("*", permitido.headers["access-control-allow-headers"])
        negado = client.options("/api/consultar-qualificado", headers={"Origin": "https://outro.exemplo", **pedido})
        self.assertEqual(negado.status_code, 400)
        self.assertNotIn("access-control-allow-origin", negado.headers)
        self.assertNotIn("access-control-allow-origin", client.get("/api/saude", headers={"Origin": "https://outro.exemplo"}).headers)


class IdiomaDaConsulta(unittest.TestCase):
    def test_locale_da_interface_vira_um_idioma_com_acervo_e_traducao(self):
        casos = {"pt-BR": "pt-BR", "pt": "pt-BR", "pt-PT": "pt-BR", "PT_br": "pt-BR", "en-US": "en-US", "en": "en-US",
                 "en-GB": "en-US", "es": "es", "es-419": "es", "es-ES": "es", "it-IT": "en-US", "fr": "en-US", "zh-Hans-CN": "en-US"}
        for locale, esperado in casos.items():
            self.assertEqual(api.CorpoConsulta(frase="fala", idioma=locale).idioma, esperado, locale)
        self.assertEqual(api.CorpoConsulta(frase="fala").idioma, "pt-BR")

    def test_idioma_que_nao_parece_locale_e_recusado(self):
        for lixo in ("", "p", "  ", "pt br", "1234", "x" * 36, "pt-" + "a" * 40, 5, None):
            with self.assertRaises(ValidationError, msg=repr(lixo)):
                api.CorpoConsulta(frase="fala", idioma=lixo)

    def test_rota_aceita_os_quatro_locales_do_app(self):
        client = TestClient(api.app)
        with patch.object(api, "_qualificado", return_value=True):
            for locale in ("pt-BR", "en-US", "es-419", "it-IT"):
                # Sem conta a consulta para na autenticação (401); 422 seria o idioma recusado.
                self.assertEqual(client.post("/api/consultar-qualificado", json={"frase": "fala", "idioma": locale}).status_code, 401, locale)
            self.assertEqual(client.post("/api/consultar-qualificado", json={"frase": "fala", "idioma": "pt br"}).status_code, 422)


class SaudeDoJuiz(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        self.ambiente = patch.dict(os.environ, {"COPILOTO_DECISOR": ""})
        self.ambiente.start()
        self.addCleanup(self.ambiente.stop)

    def saude(self, url, versao, resposta):
        with patch.object(juiz_llm, "URL", url), patch.object(juiz_llm, "VERSAO", versao), \
             patch.object(juiz_llm.httpx, "get", side_effect=resposta) as get:
            return self.client.get("/api/saude").json(), get

    def test_informa_versao_e_se_o_juiz_esta_no_ar_e_se_a_versao_esta_promovida(self):
        saude, get = self.saude("http://juiz", "v2", lambda *a, **k: httpx.Response(200))
        self.assertEqual(saude["juiz_llm"], {"versao": "v2", "no_ar": True})
        self.assertTrue(saude["qualificado"])
        self.assertEqual(get.call_args.args[0], "http://juiz/health")
        self.assertEqual((saude["limiares"]["juiz_forte"], saude["limiares"]["juiz_geral"]), (0.9, 0.7))
        self.assertEqual(saude["contrato"], api.VERSAO["contrato"])

    def test_juiz_fora_do_ar_nao_derruba_a_saude(self):
        def fora(*a, **k):
            raise httpx.ConnectError("desligado")
        saude, _ = self.saude("http://juiz", "v2", fora)
        self.assertEqual(saude["juiz_llm"], {"versao": "v2", "no_ar": False})

    def test_versao_sem_promocao_ou_sem_juiz_configurado_nao_e_qualificada(self):
        saude, _ = self.saude("http://juiz", "v9", lambda *a, **k: httpx.Response(200))
        self.assertEqual((saude["juiz_llm"]["no_ar"], saude["qualificado"]), (True, False))
        saude, get = self.saude("", "v2", lambda *a, **k: httpx.Response(200))
        self.assertEqual((saude["juiz_llm"]["no_ar"], saude["qualificado"]), (False, False))
        get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
