"""Configuração de inferência sem importar modelos ou depender de uma GPU no CI."""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import embedder, metadados


class Embedder(unittest.TestCase):
    def test_gpu_carrega_fp16_cpu_preserva_fp32_e_cache_nao_recarrega(self):
        for device, kwargs, dtype in (("cpu", {}, "float32"), ("cuda", {"torch_dtype": "float16"}, "float16"),
                                     ("cuda:0", {"torch_dtype": "float16"}, "float16")):
            with self.subTest(device=device), patch.dict(embedder._MODELOS, {}, clear=True), \
                 patch.dict(os.environ, {"COPILOTO_EMBEDDER_DISPOSITIVO": device}), \
                 patch.dict(sys.modules, {"sentence_transformers": SimpleNamespace(SentenceTransformer=Mock())}):
                constructor = sys.modules["sentence_transformers"].SentenceTransformer
                model = embedder.carregar()
                self.assertIs(embedder.carregar(), model)
                constructor.assert_called_once_with(embedder.PADRAO, device=device, model_kwargs=kwargs)
                self.assertEqual(metadados.versao()["dtype_embedder"], dtype)

    def test_resultado_fp16_volta_a_float32_e_preserva_prefixo_e_lote(self):
        model = Mock()
        model.encode.return_value = np.array([[0.25, 0.75]], dtype=np.float16)
        with patch.object(embedder, "carregar", return_value=model):
            resultado = embedder.codificar_documentos(["sintético"], "intfloat/multilingual-e5-small", lote=8)
        self.assertEqual(resultado.dtype, np.float32)
        self.assertEqual(resultado.tolist(), [[0.25, 0.75]])
        model.encode.assert_called_once_with(["passage: sintético"], batch_size=8,
            normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
