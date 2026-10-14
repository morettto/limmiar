"""Preparo desacoplado da resposta HTTP, limitado e restrito ao dono do material."""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import api, acervo_profissional as personal


class PreparoMaterial(unittest.TestCase):
    def setUp(self):
        api.preparos.clear()
        self.owner, self.id = uuid4(), uuid4()
        self.fields = {"sha256": "hash", "titulo": "Obra sintética", "autores": "Autora", "tipo": "txt"}
        self.owned = {str(self.id): {"materialId": str(self.id), "authorized": False}}
        self.tasks = BackgroundTasks()

    def iniciar(self):
        return asyncio.run(api.preparar_material(self.owner, self.id, Mock(), self.tasks, "Bearer ficticio"))

    def test_retorna_antes_de_preparar_material_nao_autorizado_para_consultas(self):
        with patch.object(personal, "materiais_da_conta", return_value=self.owned), \
             patch.object(personal, "multipart_em_memoria", AsyncMock(return_value=(b"sintetico", self.fields))), \
             patch.object(api, "_preparar_em_ram") as preparar:
            status = self.iniciar()
            self.assertFalse(status["ready"])
            self.assertEqual(status["stage"], "aguardando")
            preparar.assert_not_called()
            self.assertEqual(len(self.tasks.tasks), 1)
            asyncio.run(self.tasks())
            preparar.assert_called_once()
            self.assertNotIn((str(self.owner), str(self.id)), api.preparos)

    def test_duplicata_em_andamento_nao_cria_outra_tarefa(self):
        with patch.object(personal, "materiais_da_conta", return_value=self.owned), \
             patch.object(personal, "multipart_em_memoria", AsyncMock(return_value=(b"sintetico", self.fields))):
            self.iniciar()
            self.iniciar()
            self.assertEqual(len(self.tasks.tasks), 1)

    def test_limita_arquivos_em_memoria_e_recusa_material_de_outro_dono(self):
        with patch.object(personal, "materiais_da_conta", return_value={}):
            with self.assertRaises(HTTPException) as erro:
                self.iniciar()
            self.assertEqual(erro.exception.status_code, 404)
        api.preparos.update({("outra", str(i)): {"stage": "aguardando"} for i in range(4)})
        with patch.object(personal, "materiais_da_conta", return_value=self.owned), \
             patch.object(personal, "multipart_em_memoria", AsyncMock(return_value=(b"sintetico", self.fields))):
            with self.assertRaises(HTTPException) as erro:
                self.iniciar()
            self.assertEqual(erro.exception.status_code, 429)

    def test_falha_publica_estado_sem_texto_e_permite_repetir(self):
        with patch.object(personal, "materiais_da_conta", return_value=self.owned), \
             patch.object(personal, "multipart_em_memoria", AsyncMock(return_value=(b"sintetico", self.fields))), \
             patch.object(api, "_preparar_em_ram", side_effect=RuntimeError("conteudo privado")), \
             patch.object(personal.ACERVO, "remover"):
            self.iniciar()
            asyncio.run(self.tasks())
            status = api.preparos[(str(self.owner), str(self.id))]
            self.assertEqual(status["stage"], "falhou")
            self.assertNotIn("conteudo privado", str(status))
            self.iniciar()
            self.assertEqual(len(self.tasks.tasks), 2)

    def tearDown(self):
        api.preparos.clear()

    def test_estado_publica_progresso_real_durante_inferencia(self):
        def preparar(owner, id_, data, fields, trava, progresso):
            progresso("referencias", 8, 24)
            status = api.acervo_pessoal(self.owner, "Bearer ficticio")["materials"][0]
            self.assertFalse(status["ready"])
            self.assertEqual(status["progress"], {"phase": "referencias", "completed": 8, "total": 24})
            self.assertIs(trava, api.trava_inferencia)

        with patch.object(personal, "materiais_da_conta", return_value=self.owned), \
             patch.object(personal, "multipart_em_memoria", AsyncMock(return_value=(b"sintetico", self.fields))), \
             patch.object(personal.ACERVO, "listar", return_value=[]), \
             patch.object(personal.ACERVO, "preparar", side_effect=preparar):
            self.iniciar()
            asyncio.run(self.tasks())
            self.assertNotIn((str(self.owner), str(self.id)), api.preparos)

    def test_aquece_inferencia_antes_de_publicar_servico_pronto(self):
        with patch.object(api.embedder, "carregar") as carregar, \
             patch.object(api.embedder, "codificar_consultas") as codificar, \
             patch.object(api.traducao, "aquecer") as traduzir:
            api.arrancar()
        carregar.assert_called_once()
        codificar.assert_called_once_with(["Consulta sintética de aquecimento."], lote=1)
        traduzir.assert_called_once()
