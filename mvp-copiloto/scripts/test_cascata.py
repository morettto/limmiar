"""A regra da cascata, que só o gabarito ainda usa (tools/atendimento-simulado/gold/cascata.py): os seis do aluno e a margem."""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import cascata


class Regra(unittest.TestCase):
    def test_escolhe_os_seis_de_maior_nota_do_aluno(self):
        notas = [0.1, 0.9, 0.3, 0.8, 0.5, 0.7, 0.2, 0.6]
        self.assertEqual(cascata.escolher(list("ababab" + "ab"), notas), [1, 3, 5, 7, 4, 2])

    def test_com_um_material_so_no_topo_o_ultimo_cede_a_vaga_a_outro_material(self):
        materiais = ["a"] * 7 + ["b"]
        self.assertEqual(cascata.escolher(materiais, [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]), [0, 1, 2, 3, 4, 7])
        self.assertEqual(cascata.escolher(["a"] * 3, [0.1, 0.3, 0.2]), [1, 2, 0], "sem outro material, nada a trocar")

    def test_margem_e_o_logit_do_melhor_material_menos_o_do_segundo(self):
        melhor, margem = cascata.margem(["a", "a", "b"], [0.9, 0.95, 0.5])
        self.assertEqual(melhor, 1)
        self.assertAlmostEqual(margem, math.log(0.95 / 0.05))
        self.assertEqual(cascata.margem(["a", "a"], [0.6, 0.7]), (1, math.inf))

    def test_mostra_exige_sim_do_professor_e_margem(self):
        self.assertTrue(cascata.mostra(0.5, 1.0, 1.0))
        self.assertFalse(cascata.mostra(0.49, math.inf, 1.0))
        self.assertFalse(cascata.mostra(0.99, 0.99, 1.0))


if __name__ == "__main__":
    unittest.main()
