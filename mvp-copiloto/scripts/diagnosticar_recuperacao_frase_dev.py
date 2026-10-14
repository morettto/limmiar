"""Calibra limiar de recuperação por conteúdo, sem limitar quantidade de fontes."""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from copiloto import embedder, frase, revisao_fontes, triagem_frase
from copiloto.esquema import CAMINHO_BD
from treinar_triagem_frase import exemplos


def corte(scores, recall):
    import numpy as np

    if not scores or not 0 < recall <= 1:
        raise ValueError('Corte exige fontes positivas e recall válido.')
    valores = sorted(scores)
    return float(np.nextafter(valores[math.floor((1 - recall) * len(valores))], -math.inf))


def main() -> None:
    import numpy as np

    falas = exemplos()
    cache = treinar.TREINO / 'vetores-triagem-frase-separada.npz'
    digest = hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    with np.load(cache, allow_pickle=False) as dados:
        assinatura = json.loads(str(dados['assinatura']))
        if (assinatura['falas_sha256'] != digest or assinatura['modelo'] != embedder.PADRAO
                or assinatura['entrada_sha256'] != hashlib.sha256(Path(triagem_frase.__file__).read_bytes()).hexdigest()):
            raise ValueError('Vetores não representam exatamente os textos e a entrada de desenvolvimento.')
        X = dados['X'][:, dados['X'].shape[1] // 2:].copy()
    consultas = {f['texto']: X[i] for i, f in enumerate(falas)}
    con = sqlite3.connect(f'file:{CAMINHO_BD.as_posix()}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    linhas = con.execute('select o.arquivo,o.modelo,t.pagina,t.paragrafo,t.texto,t.embedding '
                         'from trecho t join obra o on o.id=t.obra_id where o.status="pronto" and t.embedding is not null').fetchall()
    con.close()
    if not linhas or {l['modelo'] for l in linhas} != {embedder.PADRAO}:
        raise ValueError('Acervo de desenvolvimento precisa do mesmo modelo dos vetores.')
    documentos = {(l['arquivo'], l['pagina'], l['paragrafo']): l for l in linhas}
    matriz = np.vstack([np.frombuffer(l['embedding'], dtype=np.float32) for l in linhas])
    if matriz.shape[1] != X.shape[1] or not np.isfinite(matriz).all() or not np.isfinite(X).all():
        raise ValueError('Dimensões ou valores dos vetores não conferem.')
    pares, _ = treinar.conjunto_dev()
    pares = revisao_fontes.aplicar(treinar.rotulos_revisados(pares), treinar.TREINO / 'fontes-dev-semantica-v2.jsonl')
    medidos, ausentes = [], []
    contagem_ausencias = {}
    vetores = {}
    for p in pares:
        if p['alvo'] < .5:
            continue
        consulta = frase.consulta(p['fala'], p['contexto'])
        documento = documentos.get((p['arquivo'], p['pagina'], p['paragrafo']))
        if consulta not in consultas or documento is None or documento['texto'] != p['trecho']:
            motivo = 'consulta_sem_vetor' if consulta not in consultas else ('coordenada_ausente' if documento is None else 'texto_divergente')
            contagem_ausencias[motivo] = contagem_ausencias.get(motivo, 0) + 1
            ausentes.append({k: p[k] for k in ('id', 'arquivo', 'pagina', 'paragrafo')} | {'motivo': motivo,
                'citacao_contida': documento is not None and ' '.join(p['trecho'].split()) in ' '.join(documento['texto'].split())})
            continue
        vetor = consultas[consulta]
        vetores[consulta] = vetor
        score = float(np.frombuffer(documento['embedding'], dtype=np.float32) @ vetor)
        medidos.append({'grupo': p['grupo'], 'parte': p['parte'], 'score': score})
    if not medidos:
        raise ValueError('Nenhuma referência positiva conferiu literalmente com o acervo.')
    diagnosticos = []
    for recall in (.95, .97, .99, 1.):
        recuperadas = 0
        por_parte = []
        for k in range(3):
            limiar = corte([p['score'] for p in medidos if p['parte'] != k], recall)
            validacao = [p for p in medidos if p['parte'] == k]
            acertos = sum(p['score'] >= limiar for p in validacao)
            recuperadas += acertos
            por_parte.append({'parte': k, 'limiar': limiar, 'positivas': len(validacao), 'recuperadas': acertos})
        limiar = corte([p['score'] for p in medidos], recall)
        quantidades = [int(np.count_nonzero(matriz @ v >= limiar)) for v in vetores.values()]
        diagnosticos.append({'recall_ajuste': recall, 'limiar_final_dev': limiar,
            'recall_fora_da_parte': recuperadas / len(medidos), 'partes': por_parte,
            'candidatos_media': float(np.mean(quantidades)), 'candidatos_p95': float(np.quantile(quantidades, .95)),
            'fracao_do_acervo_media': float(np.mean(quantidades)) / len(linhas)})
    resultado = {'split': 'desenvolvimento-fora-da-parte', 'validacao_clinica': False,
        'corpus_trechos': len(linhas), 'referencias_medidas': len(medidos), 'referencias_ausentes': len(ausentes),
        'motivos_ausencia': contagem_ausencias,
        'cobertura_da_medicao': len(medidos) / (len(medidos) + len(ausentes)), 'ausentes': ausentes,
        'diagnosticos': diagnosticos, 'falas_sha256': digest,
        'vetores_sha256': hashlib.sha256(cache.read_bytes()).hexdigest(),
        'revisao_sha256': hashlib.sha256((treinar.TREINO / 'fontes-dev-semantica-v2.jsonl').read_bytes()).hexdigest(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (RAIZ / 'resultados/diagnostico-recuperacao-frase-dev.json').write_text(json.dumps(resultado, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in resultado.items() if k != 'ausentes'}, indent=2), flush=True)


if __name__ == '__main__':
    main()
