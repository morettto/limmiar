"""A decisão: o portão de vivência, o filtro dos trechos genéricos, a maior nota principal contra o corte, a citação
conferida e o alerta de risco, que vale com ou sem portão. Os modelos são duplos; nada carrega."""
import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import busca, decisao, juiz_pequeno, risco
from copiloto.esquema import Citacao

FRASE_CITAVEL = "O evitamento de lugares associados ao trauma limita a vida cotidiana e restringe as relações sociais."
SEGUNDA_FRASE = "Pacientes mudam de trajeto para não passar pelo local onde tudo aconteceu, mesmo que isso custe tempo."
BASE = Citacao("t0", "o0", "fonte.pdf", "Fonte", "Autor", "pt-BR", 1, 1, FRASE_CITAVEL, 0.0, "nao_verificada", 0.1)
LIMITES = {"vivencia": 0.5, "generico": 0.5, "principal": 0.9}


def candidatos(genericos: list[float]) -> list[Citacao]:
    return [replace(BASE, trecho_id=f"t{i}", obra_id=f"o{i}", arquivo=f"o{i}.pdf", generico=g,
                    texto=f"{FRASE_CITAVEL} Passagem número {i}. {SEGUNDA_FRASE}") for i, g in enumerate(genericos)]


class Decisao(unittest.TestCase):
    def decidir(self, notas, genericos=(0.1,) * 6, vivencia=0.9, alerta=False, notas_citacao=None, proveniencia=True):
        encontrados = candidatos(list(genericos))
        chamadas: list[list[str]] = []

        def principal(fala, textos):
            chamadas.append(textos)
            return notas[:len(textos)] if len(chamadas) == 1 else notas_citacao or [0.5] * len(textos)

        with patch.object(juiz_pequeno, "VERSAO", "juiz-teste"), \
             patch.object(juiz_pequeno, "vivencia", return_value=vivencia), \
             patch.object(juiz_pequeno, "principal", side_effect=principal), \
             patch.object(busca, "candidatos_amplos", return_value=encontrados) as buscar, \
             patch.object(busca, "_proveniencia_ok", return_value=proveniencia), \
             patch.object(risco, "alerta", return_value=alerta):
            resultado = decisao.decidir(None, "evito a rua do acidente", ["antes"], "paciente", None, LIMITES)
        self.julgados, self.citados, self.buscar = chamadas[:1], chamadas[1:], buscar
        return resultado

    def test_o_trecho_de_maior_nota_vira_o_unico_cartao(self):
        resultado = self.decidir([0.2, 0.97, 0.4, 0.95, 0.1, 0.1])
        cartao, = resultado.cartoes
        self.assertEqual((cartao.trecho_id, cartao.probabilidade, cartao.nivel), ("t1", 0.97, "forte"))
        self.assertEqual((resultado.juiz, resultado.completo, resultado.motivo_silencio), ("juiz-teste", True, None))
        self.assertEqual(self.buscar.call_args.args[1:3], ("evito a rua do acidente", decisao.CANDIDATOS))
        self.assertEqual(set(resultado.tempos_ms), {"risco", "portao", "busca", "juiz", "citacao"})
        json.dumps(resultado.para_json())

    def test_genericos_saem_antes_do_juiz_e_nunca_viram_cartao(self):
        genericos = [0.1, 0.9, 0.5, 0.51, 0.2, 0.99]
        resultado = self.decidir([0.95, 0.91, 0.3], genericos=genericos)
        self.assertEqual(self.julgados[0], [candidatos(genericos)[i].texto for i in (0, 2, 4)])
        self.assertEqual(resultado.cartoes[0].trecho_id, "t0")
        registros = {r["trecho_id"]: r for r in resultado.candidatos}
        self.assertEqual(len(registros), 6, "every retrieved candidate is recorded with its stored generico")
        self.assertEqual({t for t, r in registros.items() if "juiz" in r}, {"t0", "t2", "t4"})
        self.assertEqual(registros["t1"]["generico"], 0.9)

    def test_so_genericos_cala_sem_chamar_o_juiz(self):
        resultado = self.decidir([0.99], genericos=[0.8, 0.9])
        self.assertEqual((resultado.cartoes, resultado.motivo_silencio), ([], "só trechos genéricos entre os candidatos"))
        self.assertEqual(self.julgados, [])
        self.assertNotIn("juiz", resultado.tempos_ms)

    def test_abaixo_do_corte_principal_nao_ha_cartao(self):
        resultado = self.decidir([0.89, 0.2, 0.1, 0.1, 0.1, 0.1])
        self.assertEqual((resultado.cartoes, resultado.motivo_silencio), ([], "nenhum trecho com nota para cartão"))
        self.assertEqual(self.citados, [])
        no_corte = self.decidir([0.9, 0.2, 0.1, 0.1, 0.1, 0.1])
        self.assertEqual(no_corte.cartoes[0].trecho_id, "t0")

    def test_citacao_e_a_frase_do_vencedor_de_maior_nota_principal(self):
        resultado = self.decidir([0.97, 0.2, 0.1, 0.1, 0.1, 0.1], notas_citacao=[0.1, 0.8])
        self.assertEqual(self.citados, [[FRASE_CITAVEL, SEGUNDA_FRASE]])
        self.assertEqual(resultado.cartoes[0].citacao_literal, SEGUNDA_FRASE)
        primeira = self.decidir([0.97, 0.2, 0.1, 0.1, 0.1, 0.1], notas_citacao=[0.8, 0.1])
        self.assertEqual(primeira.cartoes[0].citacao_literal, FRASE_CITAVEL)

    def test_trecho_que_nao_confere_no_pdf_nao_vira_cartao(self):
        resultado = self.decidir([0.97, 0.2, 0.1, 0.1, 0.1, 0.1], proveniencia=False)
        self.assertEqual((resultado.cartoes, resultado.motivo_silencio), ([], "trecho sem citação literal conferida"))

    def test_sem_vivencia_cala_sem_busca_e_sem_juiz(self):
        resultado = self.decidir([0.99] * 6, vivencia=0.3)
        self.assertEqual((resultado.cartoes, resultado.motivo_silencio), ([], "fala sem vivência do paciente"))
        self.assertFalse(resultado.alerta_risco or resultado.clarificar)
        self.buscar.assert_not_called()
        self.assertEqual(self.julgados, [])

    def test_alerta_de_risco_vale_com_ou_sem_portao_e_nao_muda_o_cartao(self):
        calado = self.decidir([0.99] * 6, vivencia=0.3, alerta=True)
        self.assertTrue(calado.alerta_risco)
        self.assertEqual(calado.cartoes, [])
        self.buscar.assert_not_called()
        com_cartao = self.decidir([0.2, 0.97, 0.4, 0.3, 0.1, 0.1], alerta=True)
        self.assertTrue(com_cartao.alerta_risco)
        self.assertEqual(com_cartao.cartoes[0].trecho_id, "t1")

    def test_cabeca_de_risco_e_produto_escalar_mais_vies_contra_o_corte(self):
        dimensao = len(risco._PESOS)
        vetor = np.zeros((1, dimensao), dtype=np.float32)
        vetor[0, 0] = 1.0
        esperado = float(risco._PESOS[0] + risco._CABECA["vies"])
        with patch.object(risco.embedder, "codificar_consultas", return_value=vetor):
            self.assertAlmostEqual(risco.nota("quero sumir"), esperado, places=5)
            self.assertEqual(risco.alerta("quero sumir"), esperado >= risco._CABECA["corte"])

    def test_fala_do_terapeuta_nao_chama_modelo(self):
        with patch.object(juiz_pequeno, "vivencia", side_effect=AssertionError("vivência chamada")):
            resultado = decisao.decidir(None, "você pensa em se matar?", [], "terapeuta", limites=LIMITES)
        self.assertEqual(resultado.motivo_silencio, "fala do terapeuta")

    def test_sem_limiar_registrado_a_decisao_recusa_em_vez_de_inventar_um(self):
        with patch.object(juiz_pequeno, "VERSAO", "v-sem-registro"):
            self.assertIsNone(decisao.limiares())
            with self.assertRaises(ValueError):
                decisao.decidir(None, "fala", [], "paciente")

    def test_limiares_da_versao_registrada(self):
        self.assertEqual(juiz_pequeno.VERSAO, "juiz-pequeno-v1")
        self.assertEqual(decisao.limiares(), LIMITES)


if __name__ == "__main__":
    unittest.main()
