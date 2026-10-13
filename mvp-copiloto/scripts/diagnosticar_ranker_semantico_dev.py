"""Diagnóstico fora da partição de uma ordenação aprendida; não ativa filtros."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

os.environ.setdefault('COPILOTO_EMBEDDER_DISPOSITIVO', 'cpu')
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

from copiloto import embedder, frase, revisao_fontes
from copiloto.esquema import CAMINHO_BD
import treinar


def main():
    import numpy as np
    import torch
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler

    torch.set_num_threads(2)
    pares, _ = treinar.conjunto_dev()
    pares = revisao_fontes.aplicar(treinar.rotulos_revisados(pares), treinar.TREINO / 'fontes-dev-semantica-v2.jsonl')
    textos = list(dict.fromkeys(frase.consulta(p['fala'], p['contexto']) for p in pares))
    assinatura = {'consultas_sha256': hashlib.sha256(json.dumps(textos, ensure_ascii=False).encode()).hexdigest(),
        'modelo': embedder.PADRAO, 'embedder_sha256': hashlib.sha256(Path(embedder.__file__).read_bytes()).hexdigest()}
    cache = treinar.TREINO / 'vetores-ranker-fontes-dev.npz'
    if cache.exists():
        with np.load(cache, allow_pickle=False) as data:
            if json.loads(str(data['assinatura'])) != assinatura:
                raise ValueError('Cache não representa as consultas atuais.')
            vectors = data['vetores'].copy()
    else:
        previous = treinar.TREINO / 'vetores-prioridade-fontes-dev.npz'
        positivos = [p for p in pares if p['alvo'] == 1]
        old_texts = list(dict.fromkeys([*(frase.consulta(p['fala'], p['contexto']) for p in positivos), *(p['fala'] for p in positivos)]))
        old_digest = hashlib.sha256(json.dumps(old_texts, ensure_ascii=False).encode()).hexdigest()
        with np.load(previous, allow_pickle=False) as data:
            expected = {**assinatura, 'consultas_sha256': old_digest}
            if json.loads(str(data['assinatura'])) != expected:
                raise ValueError('Cache anterior não representa exatamente as consultas positivas.')
            by_text = dict(zip(old_texts, data['vetores'].copy(), strict=True))
        missing = [text for text in textos if text not in by_text]
        for start in range(0, len(missing), 16):
            batch = missing[start:start + 16]
            by_text.update(zip(batch, embedder.codificar_consultas(batch, lote=4), strict=True))
            if start % 160 == 0:
                print(f'Vetores adicionais: {min(start + 16, len(missing))}/{len(missing)}', flush=True)
        vectors = np.vstack([by_text[text] for text in textos])
        np.savez_compressed(cache, vetores=vectors, assinatura=json.dumps(assinatura, sort_keys=True))
    if len(vectors) != len(textos) or not np.isfinite(vectors).all():
        raise ValueError('Vetores incompletos ou não finitos.')
    by_text = dict(zip(textos, vectors, strict=True))
    con = sqlite3.connect(f'file:{CAMINHO_BD.as_posix()}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute('select o.arquivo,o.modelo,t.pagina,t.paragrafo,t.texto,t.embedding '
        'from trecho t join obra o on o.id=t.obra_id where o.status="pronto" and t.embedding is not null').fetchall()
    con.close()
    if {r['modelo'] for r in rows} != {embedder.PADRAO}:
        raise ValueError('Modelo do acervo não corresponde às consultas.')
    matrix = np.vstack([np.frombuffer(r['embedding'], dtype=np.float32) for r in rows])
    docs = {(r['arquivo'], r['pagina'], r['paragrafo'], r['texto']): i for i, r in enumerate(rows)}
    measured = [p for p in pares if (p['arquivo'], p['pagina'], p['paragrafo'], p['trecho']) in docs]
    queries = np.vstack([by_text[frase.consulta(p['fala'], p['contexto'])] for p in measured])
    passages = matrix[[docs[(p['arquivo'], p['pagina'], p['paragrafo'], p['trecho'])] for p in measured]]
    def features(q, d):
        return np.column_stack([(q * d).sum(axis=1), q * d, np.abs(q - d)]).astype(np.float32)
    X = features(queries, passages)
    y = np.array([p['alvo'] for p in measured], dtype=np.int32)
    folds = np.array([p['parte'] for p in measured])
    contrasts = treinar.marcar_contrastes_fontes([{**p, 'q': frase.consulta(p['fala'], p['contexto'])} for p in measured])
    sample_weights = np.array([8. if p['contraste_fonte'] else 1. for p in contrasts])
    references = {}
    for p in measured:
        if p['alvo'] == 1:
            key = frase.consulta(p['fala'], p['contexto'])
            item = references.setdefault(key, {'parte': p['parte'], 'fontes': set()})
            if item['parte'] != p['parte']:
                raise ValueError('Consulta atravessa partições.')
            item['fontes'].add(docs[(p['arquivo'], p['pagina'], p['paragrafo'], p['trecho'])])
    results = []
    for C in (.01, .1, 1., 10.):
        ranks, oof = [], np.full(len(measured), np.nan)
        for k in range(3):
            train, validation = folds != k, folds == k
            scaler = StandardScaler().fit(X[train])
            classifier = LogisticRegression(C=C, max_iter=500, class_weight='balanced').fit(scaler.transform(X[train]), y[train], sample_weight=sample_weights[train])
            oof[validation] = classifier.predict_proba(scaler.transform(X[validation]))[:, 1]
            for query, item in references.items():
                if item['parte'] != k:
                    continue
                scores = classifier.predict_proba(scaler.transform(features(np.broadcast_to(by_text[query], matrix.shape), matrix)))[:, 1]
                order = np.argsort(-scores)
                positions = np.empty(len(rows), dtype=np.int32)
                positions[order] = np.arange(1, len(rows) + 1)
                ranks.append(min(int(positions[doc]) for doc in item['fontes']))
            print(f'C={C}: partição {k} medida', flush=True)
        if not np.isfinite(oof).all():
            raise ValueError('Predições fora da partição incompletas.')
        contrast_mask = np.array([p['contraste_fonte'] for p in contrasts])
        thresholds = []
        for t in (.5, .7, .9, .95, .99):
            accepted = oof >= t
            correct = int(np.count_nonzero(accepted & (y == 1)))
            accepted_contrasts = accepted & contrast_mask
            correct_contrasts = int(np.count_nonzero(accepted_contrasts & (y == 1)))
            thresholds.append({'limiar': t, 'aprovadas': int(accepted.sum()), 'validas': correct,
                'wilson': treinar.wilson_inferior(correct, int(accepted.sum())),
                'contrastes_aprovados': int(accepted_contrasts.sum()), 'contrastes_validos': correct_contrasts,
                'wilson_contrastes': treinar.wilson_inferior(correct_contrasts, int(accepted_contrasts.sum()))})
        results.append({'C': C, 'consultas': len(ranks), 'primeira_fonte_rank_p50': float(np.median(ranks)),
            'primeira_fonte_rank_p95': float(np.quantile(ranks, .95)), 'entre_duas': float(np.mean(np.array(ranks) <= 2)),
            'limiares_diagnosticos': thresholds})
    result = {'split': 'desenvolvimento-fora-da-parte', 'validacao_clinica': False, 'corte_de_fontes': False,
        'pares_medidos': len(measured), 'pares_ausentes': len(pares) - len(measured), 'assinatura': assinatura,
        'revisao_sha256': hashlib.sha256((treinar.TREINO / 'fontes-dev-semantica-v2.jsonl').read_bytes()).hexdigest(),
        'cache_sha256': hashlib.sha256(cache.read_bytes()).hexdigest(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'resultados': results}
    (RAIZ / 'resultados/diagnostico-ranker-semantico-dev.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2), flush=True)


if __name__ == '__main__':
    main()
