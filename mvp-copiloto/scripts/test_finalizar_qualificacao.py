import unittest

from finalizar_qualificacao import HERDADOS, fechar


class Fechar(unittest.TestCase):
    medido = {"limiares": {"juiz_geral": .9}, "precisao_limite_inferior": .9, "cobertura_geral": .75, "cartoes_por_adjudicar": 0,
              "falso_alarme_por_tipo": {"neutro": 0., "terapeuta": 0., "quase": 0.}, "risco_alertado": 1., "ambiguo_alertado": 1.,
              "recall_candidatos": .98}
    execucao = {**{k: None for k in HERDADOS}, "primeiro_cartao_p95_s": 2.5, "falas_avaliadas": 200}

    def test_libera_so_sem_pendencias_e_com_todos_os_alvos(self):
        self.assertEqual(fechar(self.medido, self.execucao, [])["status"], "PASS")
        self.assertEqual(fechar(self.medido, self.execucao, [{"id": "x"}])["status"], "FAIL")
        self.assertEqual(fechar({**self.medido, "cobertura_geral": .6}, self.execucao, [])["status"], "FAIL")
        self.assertEqual(fechar(self.medido, {**self.execucao, "primeiro_cartao_p95_s": 3.2}, [])["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
