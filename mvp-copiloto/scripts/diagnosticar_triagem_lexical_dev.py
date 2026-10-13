"""Mede recursos lexicais aprendidos somente nas partições de desenvolvimento."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

from calibrar_triagem_frase import RECALL_MINIMO
from diagnosticar_triagem_dev import metricas
from treinar_triagem_frase import exemplos


def vetores(treino, valida):
    from scipy.sparse import hstack
    from sklearn.feature_extraction.text import TfidfVectorizer

    X, V = [], []
    for campo in ('fala', 'texto'):
        for analyzer, ngram in (('word', (1, 2)), ('char_wb', (3, 5))):
            modelo = TfidfVectorizer(analyzer=analyzer, ngram_range=ngram, min_df=2,
                                    sublinear_tf=True, max_features=30000)
            X.append(modelo.fit_transform([f[campo] for f in treino]))
            V.append(modelo.transform([f[campo] for f in valida]))
    return hstack(X, format='csr'), hstack(V, format='csr')


def main() -> None:
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    falas = exemplos()
    partes = np.array([f['parte'] for f in falas])
    if set(partes) != {0, 1, 2} or any(f['id'].startswith(('teste-', 'final')) for f in falas):
        raise ValueError('Diagnóstico exige somente os três grupos de desenvolvimento.')
    Y = np.array([[f[c] for c in RECALL_MINIMO] for f in falas], dtype=np.int32)
    resultados = []
    for C in (1., 10., 100.):
        scores = np.empty_like(Y, dtype=np.float64)
        for k in range(3):
            X, V = vetores([f for f in falas if f['parte'] != k], [f for f in falas if f['parte'] == k])
            for j, campo in enumerate(RECALL_MINIMO):
                modelo = LogisticRegression(C=C, class_weight='balanced', max_iter=1000, solver='liblinear')
                modelo.fit(X, Y[partes != k, j])
                scores[partes == k, j] = modelo.decision_function(V)
        linha = {'C': C, 'metricas': {c: metricas(scores[:, j], Y[:, j], minimo)
                                     for j, (c, minimo) in enumerate(RECALL_MINIMO.items())}}
        resultados.append(linha)
        print(json.dumps(linha, ensure_ascii=False), flush=True)
    destino = RAIZ / 'resultados/diagnostico-triagem-lexical-frase-dev.json'
    destino.write_text(json.dumps({'split': 'desenvolvimento-fora-da-parte', 'validacao_clinica': False,
        'vocabulario_ajustado_somente_treino': True, 'comparacoes': resultados,
        'falas_sha256': hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
