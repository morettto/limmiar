"""Mede prioridade das fontes de desenvolvimento sem retirar candidatos."""
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

from copiloto import embedder, frase, hibrido, revisao_fontes
from copiloto.esquema import CAMINHO_BD
import treinar


def main():
    import numpy as np
    import torch

    torch.set_num_threads(2)
    pares, _ = treinar.conjunto_dev()
    pares = revisao_fontes.aplicar(treinar.rotulos_revisados(pares), treinar.TREINO / 'fontes-dev-semantica-v2.jsonl')
    positivos = [p for p in pares if p['alvo'] == 1]
    consultas = {}
    for p in positivos:
        key = frase.consulta(p['fala'], p['contexto'])
        item = consultas.setdefault(key, {'fala': p['fala'], 'parte': p['parte'], 'fontes': set()})
        if item['parte'] != p['parte']:
            raise ValueError('A mesma consulta atravessa partições.')
        item['fontes'].add((p['arquivo'], p['pagina'], p['paragrafo'], p['trecho']))
    textos = list(dict.fromkeys([*consultas, *(c['fala'] for c in consultas.values())]))
    assinatura = {'consultas_sha256': hashlib.sha256(json.dumps(textos, ensure_ascii=False).encode()).hexdigest(),
        'modelo': embedder.PADRAO, 'embedder_sha256': hashlib.sha256(Path(embedder.__file__).read_bytes()).hexdigest()}
    cache = treinar.TREINO / 'vetores-prioridade-fontes-dev.npz'
    if cache.exists():
        with np.load(cache, allow_pickle=False) as data:
            if json.loads(str(data['assinatura'])) != assinatura:
                raise ValueError('Cache não corresponde exatamente às consultas atuais.')
            vetores = data['vetores'].copy()
    else:
        lotes = []
        for inicio in range(0, len(textos), 16):
            lotes.append(embedder.codificar_consultas(textos[inicio:inicio + 16], lote=4))
            if inicio % 160 == 0:
                print(f'Vetores de desenvolvimento: {min(inicio + 16, len(textos))}/{len(textos)}', flush=True)
        vetores = np.vstack(lotes)
        np.savez_compressed(cache, vetores=vetores, assinatura=json.dumps(assinatura, sort_keys=True))
    if len(vetores) != len(textos) or not np.isfinite(vetores).all():
        raise ValueError('Vetores incompletos ou não finitos.')
    por_texto = dict(zip(textos, vetores, strict=True))
    con = sqlite3.connect(f'file:{CAMINHO_BD.as_posix()}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    linhas = con.execute('select o.arquivo,o.modelo,t.pagina,t.paragrafo,t.texto,t.embedding '
        'from trecho t join obra o on o.id=t.obra_id where o.status="pronto" and t.embedding is not null').fetchall()
    con.close()
    if not linhas or {l['modelo'] for l in linhas} != {embedder.PADRAO}:
        raise ValueError('Acervo não usa o mesmo modelo das consultas.')
    matriz = np.vstack([np.frombuffer(l['embedding'], dtype=np.float32) for l in linhas])
    if matriz.shape[1] != vetores.shape[1] or not np.isfinite(matriz).all():
        raise ValueError('Matriz do acervo incompatível.')
    documentos = {(l['arquivo'], l['pagina'], l['paragrafo'], l['texto']): i for i, l in enumerate(linhas)}
    lexical = hibrido.IndiceLexical([l['texto'] for l in linhas])
    medidas = {nome: [] for nome in ('entrada_juiz', 'frase_literal', 'ambas')}
    ausentes = 0
    for numero, (key, item) in enumerate(consultas.items()):
        fontes = [documentos[f] for f in item['fontes'] if f in documentos]
        ausentes += len(item['fontes']) - len(fontes)
        if not fontes:
            continue
        dense_key = np.argsort(-(matriz @ por_texto[key])).tolist()
        dense_fala = np.argsort(-(matriz @ por_texto[item['fala']])).tolist()
        lex_key = lexical.ordenar(key, len(linhas))
        lex_fala = lexical.ordenar(item['fala'], len(linhas))
        for nome, listas in [('entrada_juiz', [dense_key, lex_key]), ('frase_literal', [dense_fala, lex_fala]),
                             ('ambas', [dense_fala, lex_fala, dense_key, lex_key])]:
            ordem = hibrido.fundir_rrf(*listas, k=len(linhas))
            if set(ordem) != set(range(len(linhas))):
                raise ValueError('A ordenação retirou candidatos.')
            posicoes = {doc: rank + 1 for rank, doc in enumerate(ordem)}
            ranks = [posicoes[f] for f in fontes]
            medidas[nome].append({'parte': item['parte'], 'primeira_fonte': min(ranks), 'fontes': ranks})
        if numero % 160 == 0:
            print(f'Consultas ordenadas: {numero + 1}/{len(consultas)}', flush=True)
    resumo = {}
    for nome, itens in medidas.items():
        primeiras = [x['primeira_fonte'] for x in itens]
        todos = [rank for x in itens for rank in x['fontes']]
        resumo[nome] = {'consultas': len(itens), 'referencias': len(todos),
            'primeira_fonte_rank_p50': float(np.median(primeiras)),
            'primeira_fonte_rank_p95': float(np.quantile(primeiras, .95)),
            'referencias_rank_p95': float(np.quantile(todos, .95)),
            'primeira_fonte_entre_duas': float(np.mean(np.array(primeiras) <= 2))}
    resultado = {'split': 'desenvolvimento', 'validacao_clinica': False, 'corte_de_fontes': False,
        'corpus_trechos': len(linhas), 'fontes_ausentes': ausentes, 'medidas': resumo,
        'assinatura': assinatura, 'vetores_sha256': hashlib.sha256(cache.read_bytes()).hexdigest(),
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'consultas': medidas}
    (RAIZ / 'resultados/diagnostico-prioridade-fontes-dev.json').write_text(json.dumps(resultado, indent=2), encoding='utf-8')
    print(json.dumps(resumo, indent=2), flush=True)


if __name__ == '__main__':
    main()
