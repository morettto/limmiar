import unittest

from treinar_triagem_balanceada import pesos_positivos


class PesosTriagem(unittest.TestCase):
    def test_peso_da_classe_rara_e_calculado_apenas_das_falas_recebidas(self):
        falas = [{'clinica': 1., 'risco': float(i == 0), 'ambigua': float(i == 1)} for i in range(9)]
        falas.append({'clinica': 0., 'risco': 0., 'ambigua': 0.})
        self.assertEqual(pesos_positivos(falas), [1 / 9, 9., 9.])
        self.assertEqual(pesos_positivos(falas[:2] + [falas[-1]]), [.5, 2., 2.])

    def test_recusa_rotulos_nao_binarios_ou_decisoes_sem_duas_classes(self):
        with self.assertRaisesRegex(ValueError, 'positivos e negativos'):
            pesos_positivos([{'clinica': 1., 'risco': 1., 'ambigua': 1.}])
        with self.assertRaisesRegex(ValueError, 'binário'):
            pesos_positivos([{'clinica': True}, {'clinica': 0.}])


if __name__ == '__main__':
    unittest.main()
