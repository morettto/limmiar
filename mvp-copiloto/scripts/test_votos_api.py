import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import acervo_profissional as personal, api, votos

CONTA = str(uuid4())
EVENTO = {"v": 1, "consentiu": True, "usuario": "pseudonimo-secreto", "fala": "não consigo respirar no elevador",
          "contexto": ["antes"], "trecho": "O medo leva à evitação.", "obra": "obra.pdf", "voto": "util", "juiz": "v1",
          "em": "2026-10-08T10:00:00Z"}
AUTH = {"Authorization": "Bearer token"}


class Votos(unittest.TestCase):
    real = staticmethod(personal.materiais_autorizados)

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.arquivo = Path(self.dir.name) / "votos" / "votos.jsonl"
        for p in (patch.object(votos, "ARQUIVO", self.arquivo),
                  patch.object(personal, "materiais_autorizados", return_value={})):
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(api.app)

    def enviar(self, evento=EVENTO, headers=AUTH, conta=CONTA):
        return self.client.post(f"/api/votos?accountId={conta}", content=json.dumps(evento), headers=headers)

    def linhas(self):
        return self.arquivo.read_text(encoding="utf-8").splitlines()

    def test_aceita_e_anexa_uma_linha(self):
        self.assertEqual(self.enviar().status_code, 204)
        self.assertEqual(self.enviar().status_code, 204)
        self.assertEqual([json.loads(l) for l in self.linhas()], [EVENTO, EVENTO])

    def test_rejeita_sem_consentimento_ou_malformado(self):
        self.assertEqual(self.enviar({**EVENTO, "consentiu": False}).status_code, 400)
        self.assertEqual(self.enviar({"v": 1}).status_code, 400)
        self.assertEqual(self.client.post(f"/api/votos?accountId={CONTA}", content="{", headers=AUTH).status_code, 400)
        self.assertFalse(self.arquivo.exists())

    def test_rejeita_excesso_de_tamanho(self):
        for excesso in ({"fala": "x" * 2001}, {"trecho": "x" * 3001}, {"contexto": ["x"] * 6},
                        {"contexto": ["x" * 2001]}, {"obra": "x" * 201}, {"usuario": "x" * 201}):
            self.assertEqual(self.enviar({**EVENTO, **excesso}).status_code, 400, excesso)
        self.assertEqual(self.enviar({**EVENTO, "extra": "x" * 16384}).status_code, 400)
        self.assertFalse(self.arquivo.exists())

    def test_rejeita_sem_autorizacao(self):
        with patch.object(personal, "materiais_autorizados", wraps=self.real):
            self.assertEqual(self.enviar(headers={}).status_code, 401)
        with patch.object(personal, "materiais_autorizados", side_effect=HTTPException(status_code=403)):
            self.assertEqual(self.enviar().status_code, 403)
        self.assertFalse(self.arquivo.exists())

    def test_concorrencia_nao_mistura_linhas(self):
        with ThreadPoolExecutor(8) as pool:
            codigos = list(pool.map(lambda i: self.enviar({**EVENTO, "fala": f"fala {i}"}).status_code, range(40)))
        self.assertEqual(codigos, [204] * 40)
        self.assertEqual(sorted(json.loads(l)["fala"] for l in self.linhas()), sorted(f"fala {i}" for i in range(40)))

    def test_corpo_e_usuario_nao_vao_para_o_log(self):
        with self.assertLogs(level="DEBUG") as logs:
            logging_marker = __import__("logging").getLogger("teste")
            logging_marker.debug("marcador")
            self.enviar()
            self.enviar({**EVENTO, "consentiu": False})
        texto = "\n".join(logs.output)
        for segredo in ("pseudonimo-secreto", "elevador", "evitação"):
            self.assertNotIn(segredo, texto)


if __name__ == "__main__":
    unittest.main()
