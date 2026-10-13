"""Triagem RBF sobre os vetores da frase; corte calibrado fora da partição, só no desenvolvimento."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from calibrar_triagem_frase import RECALL_MINIMO
from diagnosticar_triagem_dev import metricas
from treinar_triagem_frase import exemplos
from copiloto import frase, triagem_frase

C, GAMMA = 10., 1.
DESTINO = treinar.MODELOS / 'triagem-frase-rbf'


def main() -> None:
    import numpy as np
    from sklearn.svm import SVC

    falas = exemplos()
    digest = hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    from copiloto import embedder

    assinatura = {'falas_sha256': digest, 'modelo': embedder.PADRAO,
                  'formato_sha256': hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest(),
                  'entrada_sha256': hashlib.sha256(Path(triagem_frase.__file__).read_bytes()).hexdigest()}
    cache = treinar.TREINO / 'vetores-triagem-frase-rbf.npz'
    X = None
    if cache.exists():
        with np.load(cache, allow_pickle=False) as dados:
            if json.loads(str(dados['assinatura'])) == assinatura:
                X = dados['X'].astype(np.float64)
    if X is None:
        X = triagem_frase.codificar([f['fala'] for f in falas], [f['contexto'] for f in falas], embedder.PADRAO)
        np.savez(cache, X=X, assinatura=json.dumps(assinatura, sort_keys=True))
        X = X.astype(np.float64)
    partes = np.array([f['parte'] for f in falas])
    pesos, linhas, medidas = {}, [{'id': f['id'], 'grupo': f['grupo'], 'parte': int(f['parte']), 'notas': {},
                                   'alvo': {c: f[c] for c in RECALL_MINIMO}} for f in falas], {}
    for campo, minimo in RECALL_MINIMO.items():
        alvos = np.array([f[campo] for f in falas], dtype=np.int32)
        scores = np.empty(len(falas))
        for k in range(treinar.PARTES):
            modelo = SVC(C=C, gamma=GAMMA, class_weight='balanced').fit(X[partes != k], alvos[partes != k])
            scores[partes == k] = modelo.decision_function(X[partes == k])
        medidas[campo] = metricas(scores, alvos, minimo)
        corte = medidas[campo]['limiar_score']
        for linha, s in zip(linhas, scores, strict=True):
            linha['notas'][campo] = float(1 / (1 + np.exp(-(s - corte))))
        final = SVC(C=C, gamma=GAMMA, class_weight='balanced').fit(X, alvos)
        sv, dual, b = final.support_vectors_, final.dual_coef_[0], float(final.intercept_[0])
        conferencia = np.exp(-GAMMA * ((X[:16, None, :] - sv[None]) ** 2).sum(-1)) @ dual + b
        if not np.allclose(conferencia, final.decision_function(X[:16]), atol=1e-6):
            raise ValueError('Inferência numpy diverge do SVC.')
        pesos[f'{campo}_sv'], pesos[f'{campo}_dual'] = sv.astype(np.float32), dual.astype(np.float32)
        pesos[f'{campo}_b'], pesos[f'{campo}_corte'] = np.float64(b), np.float64(corte)
        print(json.dumps({campo: medidas[campo]}, ensure_ascii=False), flush=True)
    DESTINO.mkdir(parents=True, exist_ok=True)
    np.savez(DESTINO / 'rbf.npz', gamma=np.float64(GAMMA), modelo=assinatura['modelo'], **pesos)
    treinar.gravar_jsonl(treinar.TREINO / 'oof-triagem-frase-rbf.jsonl', linhas)
    (DESTINO / 'treino.json').write_text(json.dumps({
        'split': 'desenvolvimento', 'validacao_clinica': False, 'C': C, 'gamma': GAMMA, 'falas_sha256': digest,
        'formato_sha256': assinatura['formato_sha256'], 'entrada_sha256': assinatura['entrada_sha256'],
        'modelo': assinatura['modelo'], 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'metricas_fora_da_parte': medidas}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(falas)} frases de desenvolvimento; nenhuma frase de teste usada.', flush=True)


if __name__ == '__main__':
    main()
