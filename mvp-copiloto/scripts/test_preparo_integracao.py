"""HTTP e trabalho reais; somente autenticação externa e modelo de embedding são simulados."""
import hashlib
import io
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
import numpy as np
import uvicorn
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import api, acervo_profissional as personal


class PreparoIntegracao(unittest.TestCase):
    def setUp(self):
        api.preparos.clear()
        self.owner, self.id = str(uuid4()), str(uuid4())
        self.owned = {self.id: {"materialId": self.id, "authorized": False}}
        self.store = personal.Acervo()
        self.entrou, self.liberar = threading.Event(), threading.Event()
        self.codificados = []
        self.patches = [patch.object(personal, "ACERVO", self.store),
                        patch.object(personal, "materiais_da_conta", side_effect=lambda owner, *_: self.owned if owner == self.owner else {}),
                        patch.object(personal.embedder, "codificar_documentos", side_effect=self.embedding)]
        for patch_ in self.patches:
            patch_.start()
        self.servidor = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=0,
            lifespan="off", log_level="error", http="h11", ws="none", loop="asyncio"))
        self.thread = threading.Thread(target=self.servidor.run, daemon=True)
        self.client = None
        self.addCleanup(self.fechar)
        self.thread.start()
        self.esperar(lambda: self.servidor.started)
        self.client = httpx.Client(base_url=f"http://127.0.0.1:{self.servidor.servers[0].sockets[0].getsockname()[1]}", timeout=5)
        self.url = f"/api/acervo/{self.owner}"
        self.data = self.pdf()
        self.fields = {"titulo": "Fonte privada sintética", "autores": "Autora sintética", "tipo": "pdf",
                       "sha256": hashlib.sha256(self.data).hexdigest()}

    @staticmethod
    def pdf():
        writer = PdfWriter()
        for _ in range(2):
            page = writer.add_blank_page(width=600, height=800)
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject()
            stream.set_data(b"BT /F1 10 Tf 20 700 Td (Referencia sintetica privada repetida em duas paginas.) Tj ET")
            page[NameObject("/Contents")] = stream
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()

    @staticmethod
    def esperar(condicao):
        limite = time.monotonic() + 5
        while not condicao():
            if time.monotonic() >= limite:
                raise AssertionError("Condição de integração não concluída em 5 s")
            time.sleep(0.01)

    def embedding(self, textos, *args, **kwargs):
        self.codificados.extend(textos)
        self.entrou.set()
        if not self.liberar.wait(10):
            raise AssertionError("Teste não liberou inferência")
        return np.ones((len(textos), 2), dtype=np.float32)

    def preparar(self):
        return self.client.post(f"{self.url}/{self.id}/preparar", data=self.fields,
                                files={"file": ("fonte.pdf", self.data, "application/pdf")})

    def test_http_202_progresso_deduplicacao_e_paginas_sem_autorizacao_de_consulta(self):
        resposta = self.preparar()
        self.assertEqual(resposta.status_code, 202)
        self.assertTrue(self.entrou.wait(2))
        self.assertFalse(self.liberar.is_set())
        status = self.client.get(self.url).json()["materials"][0]
        self.assertEqual(status["progress"], {"phase": "referencias", "completed": 0, "total": 1})
        self.assertFalse(status["ready"])
        self.assertNotIn("Referencia sintetica privada", str(status))
        self.assertEqual(self.preparar().status_code, 202)
        self.assertEqual(len(self.codificados), 1)
        self.liberar.set()
        self.esperar(lambda: bool(self.store.listar(self.owner)))
        pronto = self.client.get(self.url).json()["materials"][0]
        self.assertTrue(pronto["ready"])
        self.assertEqual(pronto["paragraphs"], 2)
        self.assertFalse(self.owned[self.id]["authorized"])
        snapshot = self.store.snapshot(self.owner, [self.id])
        try:
            for pagina in [1, 2]:
                self.assertTrue(snapshot.proveniencia(self.id, pagina, "Referencia sintetica privada"))
        finally:
            snapshot.connection.close()

    def test_outro_dono_recusado_e_exclusao_durante_trabalho_nao_recria_material(self):
        outro = self.client.post(f"/api/acervo/{uuid4()}/{self.id}/preparar", data=self.fields,
                                files={"file": ("fonte.pdf", self.data, "application/pdf")})
        self.assertEqual(outro.status_code, 404)
        self.assertFalse(self.entrou.is_set())
        self.assertEqual(self.preparar().status_code, 202)
        self.assertTrue(self.entrou.wait(2))
        self.owned.clear()
        self.assertEqual(self.client.delete(f"{self.url}/{self.id}").status_code, 204)
        self.liberar.set()
        self.esperar(lambda: (self.owner, self.id) not in api.preparos)
        self.assertEqual(self.store.listar(self.owner), [])
        self.assertEqual(self.client.get(self.url).json(), {"materials": []})

    def fechar(self):
        self.liberar.set()
        if self.client is not None:
            self.client.close()
        self.servidor.should_exit = True
        self.thread.join(timeout=5)
        for patch_ in reversed(self.patches):
            patch_.stop()
        api.preparos.clear()
        self.assertFalse(self.thread.is_alive())


if __name__ == "__main__":
    unittest.main()
