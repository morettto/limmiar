"""Provas de isolamento, RAM, autenticação e gate com materiais sintéticos."""
import hashlib
import importlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
import numpy as np
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import acervo_profissional as personal, api, busca, decisao, treinado, juiz

TEXT = "O evitamento de lugares associados ao trauma limita a vida cotidiana e restringe as relações sociais."


class AcervoProfissional(unittest.TestCase):
    def setUp(self):
        self.owner, self.other, self.material_id = str(uuid4()), str(uuid4()), str(uuid4())
        self.data = TEXT.encode()
        self.fields = {"titulo": "Obra privada sintética", "autores": "Autora fictícia", "tipo": "txt",
                       "sha256": hashlib.sha256(self.data).hexdigest()}
        self.store = personal.Acervo()
        self.client = TestClient(api.app)
        self.patch_store = patch.object(personal, "ACERVO", self.store)
        self.patch_store.start()
        self.addCleanup(self.patch_store.stop)
        self.embedding = patch.object(personal.embedder, "codificar_documentos", side_effect=lambda texts, *a, **k: np.ones((len(texts), 2), dtype=np.float32))
        self.embedding.start(); self.addCleanup(self.embedding.stop)

    def authorized(self):
        return {self.material_id: {"materialId": self.material_id, "authorized": True}}

    def prepare(self):
        return self.store.preparar(self.owner, self.material_id, self.data, self.fields)

    def test_ram_snapshot_isolates_owner_verifies_literal_page_and_keeps_every_paragraph(self):
        with patch.object(Path, "write_bytes", side_effect=AssertionError("disk")), patch.object(Path, "open", side_effect=AssertionError("disk")):
            material = self.prepare()
            snapshot = self.store.snapshot(self.owner, [self.material_id])
        self.assertEqual(material.status()["sha256"], self.fields["sha256"])
        self.assertEqual(snapshot.connection.execute("pragma database_list").fetchone()[2], "")
        self.assertTrue(snapshot.proveniencia(self.material_id, 1, TEXT))
        for args in ((self.material_id, 0, TEXT), (self.material_id, 2, TEXT), (self.material_id, 1, "inventado"), (self.material_id, 1, " "), ("other", 1, TEXT)):
            self.assertFalse(snapshot.proveniencia(*args))
        self.assertEqual(snapshot.signature(), [{"id": self.material_id, "hash": self.fields["sha256"], "model": material.model}])
        snapshot.connection.close()
        self.assertEqual(self.store.listar(self.other), [])
        with self.assertRaises(HTTPException): self.store.snapshot(self.other, [self.material_id])
        long = (TEXT + " ") * 100
        self.store.preparar(self.owner, self.material_id, long.encode(), {**self.fields, "sha256": hashlib.sha256(long.encode()).hexdigest()})
        snapshot = self.store.snapshot(self.owner, [self.material_id])
        self.assertGreater(len(snapshot.index.ids), 8)
        normalized = " ".join(" ".join(block.texto for block in snapshot.materials[0].blocks).split())
        self.assertEqual(normalized, " ".join(long.split()))
        snapshot.connection.close()
        unbroken = "a" * 10000
        material = self.store.preparar(self.owner, self.material_id, unbroken.encode(), {**self.fields, "sha256": hashlib.sha256(unbroken.encode()).hexdigest()})
        self.assertTrue(all(len(block.texto) <= personal.parse.MAX_CARACTERES for block in material.blocks))
        self.assertEqual("".join(block.texto for block in material.blocks), unbroken)

    def test_validation_recuses_wrong_hash_binary_pdf_invalid_type_and_empty_material(self):
        for data, fields in [(self.data, {**self.fields, "sha256": "wrong"}), (self.data, {**self.fields, "titulo": " "}),
                             (self.data, {**self.fields, "autores": " "}), (self.data, {**self.fields, "tipo": "audio"}),
                             (b"%PDF-broken", {**self.fields, "tipo": "pdf", "sha256": hashlib.sha256(b"%PDF-broken").hexdigest()}),
                             (b"\0", {**self.fields, "sha256": hashlib.sha256(b"\0").hexdigest()}),
                             (b"\xff", {**self.fields, "sha256": hashlib.sha256(b"\xff").hexdigest()}), (b"", self.fields),
                             (b" ", {**self.fields, "sha256": hashlib.sha256(b" ").hexdigest()})]:
            with self.assertRaises(HTTPException): self.store.preparar(self.owner, self.material_id, data, fields)
        writer = PdfWriter(); writer.add_blank_page(width=100, height=100)
        buffer = io.BytesIO(); writer.write(buffer); data = buffer.getvalue()
        with self.assertRaises(HTTPException) as failure:
            self.store.preparar(self.owner, self.material_id, data, {**self.fields, "tipo": "pdf", "sha256": hashlib.sha256(data).hexdigest()})
        self.assertEqual(failure.exception.detail["code"], "material.no_text")

    def test_pdf_bytesio_preserves_page_numbers_and_provenance(self):
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
        buffer = io.BytesIO(); writer = PdfWriter()
        for text in ("Primeira pagina de uma fonte bibliografica ficticia.", "Segunda pagina de uma fonte bibliografica ficticia."):
            page = writer.add_blank_page(width=600, height=800)
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject(); stream.set_data(f"BT /F1 10 Tf 20 700 Td ({text}) Tj ET".encode())
            page[NameObject("/Contents")] = stream
        writer.write(buffer)
        data = buffer.getvalue()
        material = self.store.preparar(self.owner, self.material_id, data, {**self.fields, "tipo": "pdf", "sha256": hashlib.sha256(data).hexdigest()})
        snapshot = self.store.snapshot(self.owner, [self.material_id])
        self.assertEqual(len(material.pages), 2)
        self.assertTrue(snapshot.proveniencia(self.material_id, 2, "Segunda pagina"))
        self.assertFalse(snapshot.proveniencia(self.material_id, 1, "Segunda pagina"))
        snapshot.connection.close()

    def test_backend_authorization_uses_fixed_host_header_and_purges_revoked_items(self):
        self.prepare()
        with patch.object(personal.httpx, "get", return_value=httpx.Response(200, json={"materials": list(self.authorized().values())})) as get:
            self.assertEqual(personal.materiais_autorizados(self.owner, "Bearer opaque"), self.authorized())
            self.assertEqual(get.call_args.args[0], f"http://127.0.0.1:5259/accounts/{self.owner}/materials")
            self.assertEqual(get.call_args.kwargs["headers"], {"Authorization": "Bearer opaque"})
        with patch.object(personal.httpx, "get", return_value=httpx.Response(200, json={"materials": []})):
            self.assertEqual(personal.materiais_autorizados(self.owner, "Bearer opaque"), {})
        self.assertEqual(self.store.listar(self.owner), [])

    def test_api_address_comes_from_copiloto_api_url_and_loopback_is_only_the_dev_default(self):
        with patch.dict(os.environ, {"COPILOTO_API_URL": "https://api.exemplo/"}):
            importlib.reload(personal)
            self.assertEqual(personal.API_PRODUTO, "https://api.exemplo")
        with patch.dict(os.environ):
            os.environ.pop("COPILOTO_API_URL", None)
            importlib.reload(personal)
            self.assertEqual(personal.API_PRODUTO, "http://127.0.0.1:5259")

    def test_auth_failure_closed_for_missing_token_bad_account_errors_and_api_denial(self):
        for auth in (None, "", "Basic secret", "Bearer "):
            with self.assertRaises(HTTPException): personal.materiais_autorizados(self.owner, auth)
        with self.assertRaises(HTTPException): personal.materiais_autorizados("invalid", "Bearer token")
        for response in (httpx.Response(401), httpx.Response(403), httpx.Response(500), httpx.Response(200, json={}), httpx.Response(200, json={"materials": [{"materialId": "bad", "authorized": True}]})):
            with patch.object(personal.httpx, "get", return_value=response), self.assertRaises(HTTPException):
                personal.materiais_autorizados(self.owner, "Bearer token")
        with patch.object(personal.httpx, "get", side_effect=httpx.ConnectError("offline")), self.assertRaises(HTTPException):
            personal.materiais_autorizados(self.owner, "Bearer token")

    def test_http_upload_parses_only_memory_fields_and_ready_requires_real_preparation(self):
        with patch.object(personal, "materiais_autorizados", return_value=self.authorized()), patch.object(Path, "write_bytes", side_effect=AssertionError("disk")):
            response = self.client.post(f"/api/acervo/{self.owner}/{self.material_id}/preparar", headers={"Authorization": "Bearer opaque"},
                                        data=self.fields, files={"file": ("obra.txt", self.data, "text/plain")})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["ready"])
            self.assertEqual(response.json()["sha256"], self.fields["sha256"])
            self.assertEqual(self.client.get(f"/api/acervo/{self.owner}", headers={"Authorization": "Bearer opaque"}).json()["materials"], [response.json()])
            self.assertEqual(self.client.delete(f"/api/acervo/{self.owner}/{self.material_id}", headers={"Authorization": "Bearer opaque"}).status_code, 204)
            self.assertEqual(self.store.listar(self.owner), [])
        with patch.object(personal, "materiais_autorizados", return_value={}):
            response = self.client.post(f"/api/acervo/{self.other}/{self.material_id}/preparar", data=self.fields, files={"file": ("obra.txt", self.data)})
            self.assertEqual(response.status_code, 404)

    def test_multipart_recuses_unknown_duplicate_missing_and_oversize_fields(self):
        path = f"/api/acervo/{self.owner}/{self.material_id}/preparar"
        with patch.object(personal, "materiais_autorizados", return_value=self.authorized()):
            for fields in ({**self.fields, "other": "x"}, {"titulo": "missing"}, {**self.fields, "titulo": "x" * 4097}):
                response = self.client.post(path, data=fields, files={"file": ("obra.txt", self.data)})
                self.assertIn(response.status_code, (400, 413))
            self.assertEqual(self.client.post(path, content=b"invalid", headers={"Content-Type": "text/plain"}).status_code, 400)
            self.assertEqual(self.client.post(path, content=b"invalid", headers={"Content-Type": "multipart/form-data; boundary=abc"}).status_code, 400)
            with patch.object(personal, "MAX_BYTES", 3):
                self.assertEqual(self.client.post(path, data=self.fields, files={"file": ("obra.txt", self.data)}).status_code, 413)

    def test_revocation_during_preparation_or_inference_never_serves_material(self):
        path = f"/api/acervo/{self.owner}/{self.material_id}/preparar"
        with patch.object(personal, "materiais_autorizados", side_effect=[self.authorized(), {}]):
            response = self.client.post(path, data=self.fields, files={"file": ("obra.txt", self.data)})
            self.assertEqual(response.status_code, 404)
            self.assertEqual(self.store.listar(self.owner), [])
        self.prepare()
        body = {"frase": "Fala sintética", "accountId": self.owner, "materialIds": [self.material_id]}
        with patch.object(api, "_qualificado", return_value=True), patch.object(personal, "materiais_autorizados", side_effect=[self.authorized(), self.authorized(), {}]), \
             patch.object(decisao, "decidir_progressivamente", return_value=iter([decisao.Decisao([], False, False, "geral", None)])):
            response = self.client.post("/api/consultar-qualificado", headers={"Authorization": "Bearer opaque"}, json=body)
            self.assertEqual(json.loads(response.text), {"erro": "insight.indisponivel", "juiz": api.juiz_llm.VERSAO})

    def test_gate_private_auth_and_public_mutation_routes_fail_closed(self):
        self.prepare()
        body = {"frase": "Fala sintética", "accountId": self.owner, "materialIds": [self.material_id]}
        with patch.object(api, "_qualificado", return_value=False), patch.object(decisao, "decidir_progressivamente") as judge:
            self.assertEqual(self.client.post("/api/consultar-qualificado", json=body).status_code, 503)
            judge.assert_not_called()
        with patch.object(api, "_qualificado", return_value=True):
            self.assertEqual(self.client.post("/api/consultar-qualificado", json={"frase": "Fala"}).status_code, 401)
            self.assertEqual(self.client.post("/api/consultar-qualificado", json=body).status_code, 401)
        for method, path in (("POST", "/api/acervo"), ("DELETE", f"/api/acervo/{self.material_id}"), ("POST", "/api/reindexar")):
            self.assertIn(self.client.request(method, path).status_code, (404, 405))

    def test_private_retrieval_runs_through_same_judge_and_literal_gate_with_injected_index(self):
        self.prepare(); snapshot = self.store.snapshot(self.owner, [self.material_id])
        with patch.object(treinado, "triar", return_value={"clinica": .99, "risco": 0, "ambigua": 0}), \
             patch.object(treinado, "julgar", side_effect=lambda f, c, texts: [.99] * len(texts)), \
             patch.object(busca.traducao, "variantes", return_value={"pt-BR": TEXT}), \
             patch.object(busca.embedder, "codificar_consultas", return_value=np.ones((1, 2), dtype=np.float32)):
            results = list(decisao.decidir_progressivamente(snapshot.connection, TEXT, [], "paciente", "pt-BR", [self.material_id],
                decisao.LIMIARES_PADRAO, indice=snapshot.index, verificar_proveniencia=snapshot.proveniencia))
            self.assertEqual(len(results[-1].cartoes), 1)
            self.assertEqual(results[-1].cartoes[0].obra_id, self.material_id)
            self.assertEqual(results[-1].cartoes[0].citacao_literal, TEXT)
            denied = list(decisao.decidir_progressivamente(snapshot.connection, TEXT, [], "paciente", "pt-BR", [self.material_id],
                decisao.LIMIARES_PADRAO, indice=snapshot.index, verificar_proveniencia=lambda *args: False))
            self.assertEqual(denied[-1].cartoes, [])
        snapshot.connection.close()


if __name__ == "__main__": unittest.main()
