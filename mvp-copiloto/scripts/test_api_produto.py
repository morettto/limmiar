"""App de produto: só as rotas autenticadas, CORS restrito à origem do app e saúde do juiz."""
import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import api, juiz_pequeno

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


class SaudeDoJuiz(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def test_informa_versao_limiar_e_que_o_juiz_medido_nao_esta_promovido(self):
        saude = self.client.get("/api/saude").json()
        self.assertEqual((saude["juiz"], saude["promovida"]), ("juiz-pequeno-v1", False))
        self.assertTrue(saude["qualificado"])
        self.assertIsNone(saude["motivo"])
        self.assertEqual(saude["limiares"], {"vivencia": 0.5, "generico": 0.5, "principal": 0.9})
        self.assertEqual(saude["contrato"], api.VERSAO["contrato"])

    def test_versao_sem_limiar_no_registro_nao_e_qualificada_e_a_consulta_recusa(self):
        for versao in ("v9", "v2", "laya-v5-pt"):
            with patch.object(juiz_pequeno, "VERSAO", versao):
                saude = self.client.get("/api/saude").json()
                self.assertEqual((saude["qualificado"], saude["limiares"]), (False, None), versao)
                self.assertIn(versao, saude["motivo"])
                resposta = self.client.post("/api/consultar-qualificado", json={"frase": "fala"})
            self.assertEqual(resposta.status_code, 503)


if __name__ == "__main__":
    unittest.main()
