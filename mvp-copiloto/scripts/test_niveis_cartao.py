"""Níveis forte/possível do cartão pelas faixas do registro, sem teto de cartões e com a versão do juiz no resultado."""
import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import busca, decisao, juiz, juiz_llm, treinado
from copiloto.esquema import Citacao

CITACAO = "O evitamento de lugares associados ao trauma limita a vida cotidiana e restringe as relações sociais."
BASE = Citacao("t0", "o0", "fonte.pdf", "Fonte", "Autor", "pt-BR", 1, 1, CITACAO, 0.0, "nao_verificada")
V2 = {"juiz_forte": 0.9, "juiz_geral": 0.7, "juiz_risco": 0.7}
# Cinco notas que se repetem: forte, possível, no piso da faixa, logo abaixo do piso, muito abaixo.
NOTAS = [0.95, 0.8, 0.7, 0.6999, 0.2]


class NiveisDoCartao(unittest.TestCase):
    def test_forte_a_partir_do_limiar_forte_possivel_abaixo(self):
        self.assertEqual([decisao.nivel(p, V2) for p in (1.0, 0.9, 0.8999, 0.7)], ["forte", "forte", "possivel", "possivel"])
        # Sem faixas (limiares de um protocolo antigo), vale o padrão de pesquisa.
        self.assertEqual([decisao.nivel(p, {}) for p in (0.99, 0.9899)], ["forte", "possivel"])

    def test_faixas_vem_do_registro_da_versao_ativa(self):
        with patch.object(juiz_llm, "URL", "http://juiz"), patch.dict("os.environ", {"COPILOTO_DECISOR": ""}):
            self.assertEqual(decisao.arquivo_limiares().name, "limiares-juiz-llm.json")
            with patch.object(juiz_llm, "VERSAO", "v2"):
                limites = decisao.limiares()
            with patch.object(juiz_llm, "VERSAO", "v-sem-registro"):
                sem_registro = decisao.limiares()
        self.assertEqual({k: limites[k] for k in V2}, V2)
        self.assertEqual((limites["portao"], limites["risco"]), (0.2, 0.1))
        self.assertEqual(sem_registro["juiz_geral"], decisao.LIMIARES_PADRAO["juiz_geral"])

    def percorrer(self, quantidade=40):
        candidatos = [replace(BASE, trecho_id=f"t{i}", obra_id=f"o{i}", texto=f"{CITACAO} Passagem {i}.")
                      for i in range(quantidade)]
        notas = iter(NOTAS[i % len(NOTAS)] for i in range(quantidade))
        with patch.object(juiz_llm, "URL", "http://juiz"), patch.object(juiz_llm, "VERSAO", "v-teste"), \
             patch.object(juiz_llm, "reescrever", return_value=[]), \
             patch.object(treinado, "triar", return_value={"clinica": .99, "risco": 0, "ambigua": 0}), \
             patch.object(busca, "candidatos_amplos", return_value=candidatos), \
             patch.object(treinado, "julgar", side_effect=lambda f, c, textos: [next(notas) for _ in textos]), \
             patch.object(juiz, "citacoes_qualificadas",
                          side_effect=lambda f, c, textos, probs, limiar: [(CITACAO, p) for p in probs]), \
             patch.object(busca, "_proveniencia_ok", return_value=True):
            limites = {**decisao.LIMIARES_PADRAO, **V2}
            return list(decisao.decidir_progressivamente(None, "fala", [], "paciente", "pt-BR", None, limites))

    def test_julga_os_40_candidatos_sem_teto_e_os_fortes_vem_primeiro(self):
        passos = self.percorrer()
        self.assertEqual([p.fontes_avaliadas for p in passos], [8, 16, 24, 32, 40])
        self.assertEqual([p.completo for p in passos], [False] * 4 + [True])
        final = passos[-1]
        self.assertEqual(len(final.cartoes), 24)
        self.assertEqual([c.nivel for c in final.cartoes], ["forte"] * 8 + ["possivel"] * 16)
        self.assertEqual([c.probabilidade for c in final.cartoes], sorted((c.probabilidade for c in final.cartoes), reverse=True))
        self.assertEqual({c.probabilidade for c in final.cartoes}, {0.95, 0.8, 0.7})

    def test_resultado_leva_a_versao_do_juiz_e_cada_cartao_probabilidade_e_nivel(self):
        for passo in self.percorrer(8):
            dados = json.loads(json.dumps(passo.para_json()))
            self.assertEqual(dados["juiz"], "v-teste")
            self.assertTrue(dados["cartoes"])
            for cartao in dados["cartoes"]:
                self.assertIn(cartao["nivel"], ("forte", "possivel"))
                self.assertIsInstance(cartao["probabilidade"], float)


if __name__ == "__main__":
    unittest.main()
