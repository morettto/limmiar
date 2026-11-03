import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "juiz_v2"))
import avaliar_5k
import rotulos_5k


class Rotulos(unittest.TestCase):
    cartoes = [{"k": "q5k-positivo-0001|t1", "fala": "f1", "trecho": "x", "obra": "obra-a.pdf", "prob": .95, "estrato": "fonte_exata"},
               {"k": "q5k-positivo-0002|t2", "fala": "f2", "trecho": "y", "obra": "obra-a.pdf", "prob": .93, "estrato": "outro_trecho"},
               {"k": "q5k-positivo-0003|t3", "fala": "f3", "trecho": "z", "obra": "obra-b", "prob": .91, "estrato": "outro_trecho"}]

    def test_duvida_e_sem_resposta_ficam_de_fora(self):
        rows = rotulos_5k.linhas(self.cartoes, {"q5k-positivo-0001|t1": "sim", "q5k-positivo-0002|t2": "duvida"})
        self.assertEqual([(r["fala"], r["alvo"]) for r in rows], [("f1", 1)])

    def test_taxa_de_acerto_por_estrato(self):
        t = rotulos_5k.taxas(self.cartoes, {"q5k-positivo-0001|t1": "sim", "q5k-positivo-0002|t2": "nao", "q5k-positivo-0003|t3": "sim"})
        self.assertEqual((t["fonte_exata"]["acerto"], t["outro_trecho"]["acerto"]), (1.0, 0.5))

    def test_treino_suave_usa_a_nota_inclusive_duvida(self):
        rows = rotulos_5k.linhas_suaves(self.cartoes, {"q5k-positivo-0001|t1": 0.95, "q5k-positivo-0002|t2": 0.8})
        self.assertEqual([(r["alvo_suave"], r["alvo"]) for r in rows], [(0.95, 1), (0.8, 0)])

    def test_obra_fica_de_um_lado_so_com_ou_sem_pdf(self):
        self.assertEqual(rotulos_5k.lado("obra-a.pdf"), rotulos_5k.lado("obra-a"))
        self.assertEqual({rotulos_5k.lado(f"obra-{i}") for i in range(40)}, {"treino", "teste"})


class Avaliacao5k(unittest.TestCase):
    def test_spearman_de_ordens_iguais_e_opostas(self):
        self.assertAlmostEqual(avaliar_5k.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(avaliar_5k.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)

    def test_precisao_e_cobertura_no_limiar_da_nota_sim(self):
        linhas = [{"alvo_suave": n, "prob": p} for n, p in [(0.95, 0.99), (0.5, 0.95), (0.92, 0.2), (0.3, 0.1)]]
        r = avaliar_5k.resumo(linhas)
        self.assertEqual((r["aprovados"], r["precisao_sim"], r["cobertura_sim"]), (2, 0.5, 0.5))


if __name__ == "__main__":
    unittest.main()
