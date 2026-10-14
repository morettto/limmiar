from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import qualificacao

PROMOVIDA = {"versao": "v2", "promovida": True, "limiares": {"forte": 0.9, "possivel": 0.7}}
FAIXAS = {"forte": 0.9, "possivel": 0.7}


class LiberacaoPorVersao(unittest.TestCase):
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

    def test_so_libera_versao_promovida_no_registro_e_devolve_as_faixas_dela(self):
        self.assertFalse(qualificacao.qualificado("v2"))
        self.registrar(PROMOVIDA)
        self.assertTrue(qualificacao.qualificado("v2"))
        self.assertEqual(qualificacao.faixas("v2"), FAIXAS)
        self.assertFalse(qualificacao.qualificado("v3"))
        self.assertFalse(qualificacao.qualificado(""))
        self.registrar({**PROMOVIDA, "versao": "v3", "limiares": {"forte": 0.99, "possivel": 0.9}}, PROMOVIDA)
        self.assertEqual(qualificacao.faixas("v3"), {"forte": 0.99, "possivel": 0.9})
        self.assertEqual(qualificacao.faixas("v2"), FAIXAS)

    def test_exige_promovida_verdadeira_e_faixas_validas(self):
        sem_promocao = {k: v for k, v in PROMOVIDA.items() if k != "promovida"}
        invalidas = [sem_promocao, {**PROMOVIDA, "promovida": False}, {**PROMOVIDA, "promovida": "true"},
                     {**PROMOVIDA, "limiares": {"forte": 0.7, "possivel": 0.9}},
                     {**PROMOVIDA, "limiares": {"forte": 0.9, "possivel": 0}},
                     {**PROMOVIDA, "limiares": {"forte": 1.1, "possivel": 0.7}},
                     {**PROMOVIDA, "limiares": {"forte": "0.9", "possivel": 0.7}},
                     {**PROMOVIDA, "limiares": {"forte": float("nan"), "possivel": 0.7}},
                     {**PROMOVIDA, "limiares": {"forte": True, "possivel": 0.7}},
                     {**PROMOVIDA, "limiares": {"forte": 0.9}},
                     {**PROMOVIDA, "limiares": None}]
        for linha in invalidas:
            self.registrar(linha)
            self.assertFalse(qualificacao.qualificado("v2"), linha)
            self.assertIsNone(qualificacao.faixas("v2"), linha)

    def test_registro_malformado_falha_fechado(self):
        for conteudo in ["{", "[]", "null", "[1]", '{"promovida": true}']:
            self.arquivo.write_text(conteudo, encoding="utf-8")
            self.assertFalse(qualificacao.qualificado("v2"), conteudo)

    def test_registro_real_promove_a_v2_com_as_faixas_do_profissional(self):
        with patch.object(qualificacao, "RAIZ", Path(__file__).resolve().parents[1]):
            self.assertEqual(qualificacao.faixas("v2"), FAIXAS)
            self.assertFalse(qualificacao.qualificado("v0"))


class ReguaDaV1(unittest.TestCase):
    relatorio = {
        "precisao_limite_inferior": 0.96, "cartoes_por_adjudicar": 0,
        "falso_alarme_por_tipo": {"neutro": 0.0, "terapeuta": 0.0, "quase": 0.0},
        "risco_alertado": 1.0, "ambiguo_alertado": 1.0, "cobertura_geral": .75,
        "recall_candidatos": .98, "primeiro_cartao_p95_s": 2.9,
    }

    def test_atende_com_todos_os_alvos(self):
        self.assertTrue(qualificacao.atende_alvos(self.relatorio))

    def test_exige_todos_os_alvos_sem_nan_booleanos_ou_campos_incompletos(self):
        for campo in self.relatorio:
            r = copy.deepcopy(self.relatorio)
            del r[campo]
            self.assertFalse(qualificacao.atende_alvos(r), campo)
        for medido in [None, True, False, float("nan"), float("inf"), -1, 1.5, "0.99", 0.87]:
            self.assertFalse(qualificacao.atende_alvos({**self.relatorio, "precisao_limite_inferior": medido}), repr(medido))
        for campo, valor in [("falso_alarme_por_tipo", "invalido"), ("cartoes_por_adjudicar", 1),
                             ("risco_alertado", 0.94), ("ambiguo_alertado", 0.89),
                             ("recall_candidatos", .94), ("cobertura_geral", .69), ("primeiro_cartao_p95_s", 3.01)]:
            self.assertFalse(qualificacao.atende_alvos({**self.relatorio, campo: valor}), campo)
        for tipo, teto in [("neutro", 0.01), ("terapeuta", 0), ("quase", 0.02)]:
            r = copy.deepcopy(self.relatorio)
            r["falso_alarme_por_tipo"][tipo] = teto + 0.01
            self.assertFalse(qualificacao.atende_alvos(r), tipo)


if __name__ == "__main__":
    unittest.main()
