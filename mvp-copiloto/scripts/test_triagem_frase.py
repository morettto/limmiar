import unittest
from unittest.mock import patch
import numpy as np

import treinar_triagem_frase as treino
from copiloto import triagem_frase


class TriagemFrase(unittest.TestCase):
    def test_vetor_da_frase_nao_e_substituido_pelo_vetor_do_historico(self):
        vetores = np.array([[1, 2], [3, 4], [5, 6], [7, 8]], dtype=np.float32)
        with patch.object(triagem_frase.embedder, 'codificar_consultas', return_value=vetores) as codificar:
            entrada = triagem_frase.codificar(['Hoje estou bem.', 'Isso continua.'],
                                             [['Ontem fiquei com medo.'], ['Eu não durmo.']], 'modelo')
        textos = codificar.call_args.args[0]
        self.assertEqual(textos[:2], ['Hoje estou bem.', 'Isso continua.'])
        self.assertIn('Ontem fiquei com medo.', textos[2])
        self.assertIn('Eu não durmo.', textos[3])
        np.testing.assert_array_equal(entrada, [[1, 2, 5, 6], [3, 4, 7, 8]])
        with self.assertRaisesRegex(ValueError, 'próprio apoio'):
            triagem_frase.codificar(['frase'], [], 'modelo')

    def test_atribuicao_a_terceiro_nao_herda_risco_da_fala_anterior(self):
        anterior = {'id': 'dev-pos-0010', 'fala': 'Não quero mais viver.', 'contexto': [],
                    'clinica': 1.0, 'risco': 1.0, 'ambigua': 0.0}
        base = {'grupo': anterior['id'], 'contexto': [anterior['fala']], 'justificativa': 'Revisão sintética de dev.'}
        variantes = [{**base, 'id': 'ctx-dev-pos-0010-elipse', 'fala': 'Isso continua comigo.', 'valido': True},
                     {**base, 'id': 'ctx-dev-pos-0010-terceiro', 'fala': 'Foi ele quem disse isso, eu não.', 'valido': False}]
        with patch.object(treino.treinar, 'conjunto_dev', return_value=([], [anterior])), \
                patch.object(treino.treinar, 'casos', return_value=[{**anterior, 'canal': 'risco'}]), \
                patch.object(treino.treinar, 'ler_jsonl', return_value=variantes):
            falas = treino.exemplos()
        self.assertEqual([f['risco'] for f in falas], [1.0, 1.0, 0.0])
        self.assertEqual([f['clinica'] for f in falas], [1.0, 1.0, 0.0])
        self.assertEqual(len({f['parte'] for f in falas}), 1)
        self.assertLess(falas[2]['texto'].index('Foi ele'), falas[2]['texto'].index('Não quero'))

    def test_frase_repetida_e_rotulo_fraco_interrompem_treino(self):
        anterior = {'id': 'c1', 'fala': 'frase', 'contexto': []}
        with patch.object(treino.treinar, 'conjunto_dev', return_value=([], [anterior, anterior])), \
                patch.object(treino.treinar, 'casos', return_value=[]), \
                patch.object(treino.treinar, 'ler_jsonl', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'duplicadas'):
                treino.exemplos()
        contraste = {'id': 'ctx-c1-elipse', 'grupo': 'c1', 'valido': 1, 'justificativa': 'texto'}
        with patch.object(treino.treinar, 'conjunto_dev', return_value=([], [anterior])), \
                patch.object(treino.treinar, 'casos', return_value=[anterior]), \
                patch.object(treino.treinar, 'ler_jsonl', return_value=[contraste]):
            with self.assertRaisesRegex(ValueError, 'explícita'):
                treino.exemplos()


if __name__ == '__main__':
    unittest.main()
