from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import qualificacao

CORTES = {"vivencia": 0.5, "generico": 0.5, "principal": 0.9}
MEDIDA = {"versao": "juiz-v9", "promovida": False, "estado": "medida", "limiares": {**CORTES, "risco": 0.5}}


class RegistroDaVersao(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.addCleanup(self.pasta.cleanup)
        self.raiz = Path(self.pasta.name)
        (self.raiz / "data/juiz-v2").mkdir(parents=True)
        self.arquivo = self.raiz / "data/juiz-v2/registro.jsonl"
        patcher = patch.object(qualificacao, "RAIZ", self.raiz)
        patcher.start()
        self.addCleanup(patcher.stop)

    def registrar(self, *linhas):
        self.arquivo.write_text("".join(json.dumps(linha) + "\n" for linha in linhas), encoding="utf-8")

    def test_versao_medida_serve_com_os_seus_cortes_e_nao_conta_como_promovida(self):
        self.assertFalse(qualificacao.qualificado("juiz-v9"))
        self.registrar(MEDIDA)
        self.assertEqual(qualificacao.limiares("juiz-v9"), CORTES)
        self.assertTrue(qualificacao.qualificado("juiz-v9"))
        self.assertFalse(qualificacao.promovida("juiz-v9"))
        self.registrar({**MEDIDA, "promovida": True})
        self.assertTrue(qualificacao.promovida("juiz-v9"))
        self.assertFalse(qualificacao.qualificado(""))

    def test_sem_os_tres_cortes_finitos_a_versao_nao_serve(self):
        invalidas = [{**MEDIDA, "limiares": {"margem": 1.7}}, {**MEDIDA, "limiares": {"vivencia": 0.5, "relacao": 0.9}},
                     {**MEDIDA, "limiares": {**CORTES, "generico": "0.5"}}, {**MEDIDA, "limiares": {**CORTES, "vivencia": True}},
                     {**MEDIDA, "limiares": {**CORTES, "principal": float("inf")}},
                     {**MEDIDA, "limiares": None}, {k: v for k, v in MEDIDA.items() if k != "limiares"}]
        for linha in invalidas:
            self.registrar(linha)
            self.assertFalse(qualificacao.qualificado("juiz-v9"), linha)
            self.assertFalse(qualificacao.promovida("juiz-v9"), linha)

    def test_registro_malformado_falha_fechado(self):
        for conteudo in ["{", "[]", "null", "[1]", '{"promovida": true}']:
            self.arquivo.write_text(conteudo, encoding="utf-8")
            self.assertFalse(qualificacao.qualificado("juiz-v9"), conteudo)

    def test_registro_real_tem_o_juiz_pequeno_a_medir_e_nao_promovido(self):
        with patch.object(qualificacao, "RAIZ", Path(__file__).resolve().parents[1]):
            self.assertEqual(qualificacao.limiares("juiz-pequeno-v1"), CORTES)
            self.assertFalse(qualificacao.promovida("juiz-pequeno-v1"))
            self.assertFalse(qualificacao.qualificado("laya-v5-pt"), "a relação do Laya não é um corte do juiz pequeno")
            self.assertFalse(qualificacao.qualificado("cascata-v1"), "a margem da cascata não é um corte do juiz pequeno")
            self.assertFalse(qualificacao.qualificado("v2"), "as faixas do juiz LoRA não são cortes do juiz pequeno")


if __name__ == "__main__":
    unittest.main()
