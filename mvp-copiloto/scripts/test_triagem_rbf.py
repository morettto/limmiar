import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import numpy as np
from sklearn.svm import SVC

from copiloto import treinado, triagem_frase


class TriagemRbf(unittest.TestCase):
    def test_inferencia_numpy_reproduz_svc_e_corte_calibrado(self):
        gerador = np.random.default_rng(7)
        X = gerador.normal(size=(60, 4))
        y = (X[:, 0] > 0).astype(int)
        svc = SVC(C=10., gamma=1., class_weight='balanced').fit(X, y)
        pesos = {'gamma': 1., 'modelo': 'm'}
        for r in treinado.ROTULOS_TRIAGEM:
            pesos |= {f'{r}_sv': svc.support_vectors_, f'{r}_dual': svc.dual_coef_[0],
                      f'{r}_b': svc.intercept_[0], f'{r}_corte': -0.3}
        with tempfile.TemporaryDirectory() as pasta, patch.object(treinado, 'MODELOS', Path(pasta)), \
                patch.object(treinado, 'NOME_JUIZ', 'juiz'), patch.dict(treinado._CARREGADOS, clear=True), \
                patch.object(triagem_frase, 'codificar', return_value=X[:1]):
            (Path(pasta) / 'juiz/torch').mkdir(parents=True)
            (Path(pasta) / 'juiz/torch/formato.txt').write_text('qwen-frase-v2', encoding='utf-8')
            (Path(pasta) / 'triagem-frase-rbf').mkdir()
            np.savez(Path(pasta) / 'triagem-frase-rbf/rbf.npz', **pesos)
            notas = treinado.triar('fala', [])
        esperado = 1 / (1 + np.exp(-(svc.decision_function(X[:1])[0] + 0.3)))
        for r in treinado.ROTULOS_TRIAGEM:
            self.assertAlmostEqual(notas[r], esperado, places=9)


if __name__ == '__main__':
    unittest.main()
