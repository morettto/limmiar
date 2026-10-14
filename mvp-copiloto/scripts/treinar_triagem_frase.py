"""Triagem centrada na frase, com elipses e atribuição a terceiros somente de dev."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from copiloto import frase


def exemplos() -> list[dict]:
    _, falas = treinar.conjunto_dev()
    saida = [{**f, 'grupo': treinar.grupo_da_fala(f['id']),
              'texto': frase.consulta(f['fala'], f['contexto'])} for f in falas]
    originais = {c['id']: c for c in treinar.casos()}
    for p in treinar.ler_jsonl(treinar.TREINO / 'contexto-dev.jsonl'):
        if p['id'].endswith('-direta'):
            continue
        if type(p['valido']) is not bool or not p['justificativa'].strip():
            raise ValueError('Contraste de frase exige decisão explícita de desenvolvimento.')
        original = originais[p['grupo']]
        saida.append({'id': p['id'], 'grupo': p['grupo'], 'fala': p['fala'], 'contexto': p['contexto'],
                      'texto': frase.consulta(p['fala'], p['contexto']),
                      'clinica': float(p['valido']), 'risco': float(p['valido'] and original['canal'] == 'risco'),
                      'ambigua': 0.0})
    ids = [f['id'] for f in saida]
    if len(ids) != len(set(ids)):
        raise ValueError('Frases duplicadas na triagem.')
    return [{**f, 'parte': treinar.parte(f['grupo'])} for f in saida]


def main() -> None:
    import numpy as np
    import torch
    from copiloto import embedder, triagem_frase

    falas = exemplos()
    destino = treinar.MODELOS / 'triagem-frase'
    destino.mkdir(parents=True, exist_ok=True)
    manifesto = {'split': 'desenvolvimento', 'partes': treinar.PARTES,
                 'falas_sha256': hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                 'formato_sha256': hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest(),
                 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                 'entrada_sha256': hashlib.sha256(Path(triagem_frase.__file__).read_bytes()).hexdigest(),
                 'modelo': embedder.PADRAO, 'truncation': False}
    caminho_manifesto = destino / 'treino.json'
    if (destino / 'logistica.npz').exists():
        if not caminho_manifesto.exists() or json.loads(caminho_manifesto.read_text(encoding='utf-8')) != manifesto:
            raise ValueError('Triagem existente foi treinada com outra formulação; preserve sua evidência.')
        print('Triagem correspondente já treinada.', flush=True)
        return
    capacidade = embedder.carregar(embedder.PADRAO).max_seq_length
    tokenizador = embedder.carregar(embedder.PADRAO).tokenizer
    tamanhos = tokenizador([f['texto'] for f in falas], truncation=False, return_length=True)['length']
    if max(tamanhos) > capacidade:
        raise ValueError('Frase com apoio excede a capacidade da triagem; não truncar.')
    caminho_vetores = treinar.TREINO / 'vetores-triagem-frase-separada.npz'
    assinatura = json.dumps({k: manifesto[k] for k in ('falas_sha256', 'formato_sha256', 'entrada_sha256', 'modelo')}, sort_keys=True)
    if caminho_vetores.exists():
        with np.load(caminho_vetores) as dados:
            if str(dados['assinatura']) != assinatura:
                raise ValueError('Vetores pertencem a outras frases ou outra formulação.')
            X = torch.tensor(dados['X'])
    else:
        X = torch.tensor(triagem_frase.codificar([f['fala'] for f in falas], [f['contexto'] for f in falas], embedder.PADRAO))
        np.savez(caminho_vetores, X=X.numpy(), assinatura=assinatura)
    Y = torch.tensor([[f[c] for c in treinar.ROTULOS_TRIAGEM] for f in falas], dtype=torch.float32)
    P = torch.tensor([f['parte'] for f in falas])
    linhas = []
    for k in range(treinar.PARTES):
        W, b = treinar._ajustar_logistica(X[P != k], Y[P != k])
        notas = torch.sigmoid(X[P == k] @ W * 10 + b).tolist()
        for f, n in zip([f for f in falas if f['parte'] == k], notas, strict=True):
            linhas.append({'id': f['id'], 'grupo': f['grupo'], 'parte': k,
                           'notas': dict(zip(treinar.ROTULOS_TRIAGEM, n)),
                           'alvo': {c: f[c] for c in treinar.ROTULOS_TRIAGEM}})
        print(f'Parte {k}: {len(notas)} frases fora da partição.', flush=True)
    treinar.gravar_jsonl(treinar.TREINO / 'oof-triagem-frase.jsonl', linhas)
    W, b = treinar._ajustar_logistica(X, Y)
    np.savez(destino / 'logistica.npz', W=(W * 10).numpy(), b=b.numpy(),
             rotulos=np.array(treinar.ROTULOS_TRIAGEM), modelo=embedder.PADRAO)
    caminho_manifesto.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(falas)} frases de desenvolvimento; nenhuma frase de teste usada.', flush=True)


if __name__ == '__main__':
    main()
