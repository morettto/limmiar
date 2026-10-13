"""Compara fronteiras semânticas apenas no desenvolvimento fora da partição."""
from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

from calibrar_triagem_frase import RECALL_MINIMO
from treinar_triagem_frase import exemplos
from copiloto import frase, triagem_frase


def metricas(scores, alvos, recall_minimo: float) -> dict:
    import numpy as np

    positivos = int(alvos.sum())
    negativos = len(alvos) - positivos
    if not positivos or not negativos:
        raise ValueError('Cada decisão precisa de positivos e negativos.')
    ordem = np.argsort(-scores, kind='stable')
    verdadeiros = np.cumsum(alvos[ordem])
    limiar = float(scores[ordem[np.flatnonzero(verdadeiros / positivos >= recall_minimo)[0]]])
    aprovados = scores >= limiar
    vp = int(alvos[aprovados].sum())
    fp = int(aprovados.sum()) - vp
    return {'limiar_score': limiar, 'recall': vp / positivos, 'falso_positivo': fp / negativos,
            'positivos': positivos, 'negativos': negativos, 'aprovados': int(aprovados.sum())}


def main() -> None:
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.svm import SVC

    falas = exemplos()
    cache = RAIZ / 'data/treino/vetores-triagem-frase-separada.npz'
    with np.load(cache, allow_pickle=False) as dados:
        assinatura = json.loads(str(dados['assinatura']))
        digest = hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if assinatura['falas_sha256'] != digest:
            raise ValueError('Vetores não correspondem às frases e rótulos atuais.')
        if (assinatura['formato_sha256'] != hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest()
                or assinatura['entrada_sha256'] != hashlib.sha256(Path(triagem_frase.__file__).read_bytes()).hexdigest()):
            raise ValueError('Formulação dos vetores mudou; não comparar evidência obsoleta.')
        X = dados['X'].astype(np.float64)
    if len(X) != len(falas) or not np.isfinite(X).all():
        raise ValueError('Vetores incompletos ou inválidos.')
    partes = np.array([f['parte'] for f in falas])
    if set(partes) != {0, 1, 2}:
        raise ValueError('Exige três partições por grupo.')
    duplicadas = defaultdict(list)
    for f in falas:
        duplicadas[f['texto']].append(f)
    conflitos = [[{'id': f['id'], 'parte': f['parte'], 'fala': f['fala'], 'contexto': f['contexto'],
                  'alvo': {c: f[c] for c in RECALL_MINIMO}} for f in grupo]
                 for grupo in duplicadas.values()
                 if len({tuple(f[c] for c in RECALL_MINIMO) for f in grupo}) > 1]
    modelos = [('logistica', c, None) for c in (.1, 1., 10., 100.)]
    modelos += [('rbf', c, g) for c in (1., 10., 100.) for g in (.25, 1., 4.)]
    resultados = []
    for tipo, C, gamma in modelos:
        medidas, detalhes = {}, {}
        for campo, minimo in RECALL_MINIMO.items():
            alvos = np.array([f[campo] for f in falas], dtype=np.int32)
            scores = np.empty(len(falas))
            for k in range(3):
                modelo = (LogisticRegression(C=C, class_weight='balanced', max_iter=1000)
                          if tipo == 'logistica' else SVC(C=C, gamma=gamma, class_weight='balanced'))
                modelo.fit(X[partes != k], alvos[partes != k])
                scores[partes == k] = modelo.decision_function(X[partes == k])
            medidas[campo] = metricas(scores, alvos, minimo)
            detalhes[campo] = [{'id': falas[i]['id'], 'score': float(scores[i]),
                               'fala': falas[i]['fala'], 'contexto': falas[i]['contexto']}
                              for i in np.flatnonzero(alvos)[np.argsort(scores[alvos.astype(bool)])[:15]]]
        linha = {'modelo': tipo, 'C': C, 'gamma': gamma, 'metricas': medidas, 'menores_positivos': detalhes}
        resultados.append(linha)
        print(json.dumps({k: v for k, v in linha.items() if k != 'menores_positivos'}, ensure_ascii=False), flush=True)
    destino = RAIZ / 'resultados/diagnostico-triagem-frase-dev.json'
    destino.write_text(json.dumps({'split': 'desenvolvimento-fora-da-parte', 'validacao_clinica': False,
                         'vetores_sha256': hashlib.sha256(cache.read_bytes()).hexdigest(),
                         'falas_sha256': digest, 'conflitos': conflitos, 'comparacoes': resultados},
                         ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(conflitos)} grupos com rótulos conflitantes para entrada idêntica; nenhuma mudança em produção.', flush=True)


if __name__ == '__main__':
    main()
