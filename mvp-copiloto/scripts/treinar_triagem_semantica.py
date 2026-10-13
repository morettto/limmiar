"""Treina uma triagem textual de sujeito, risco e ambiguidade, apenas em dev."""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from treinar_triagem_frase import exemplos
from copiloto import frase

NOME = 'triagem-frase-mmbert'
CFG = {**treinar.CONFIG['mmbert-small'], 'lr': 3e-5, 'lote': 8, 'acumular': 2, 'epocas': 3}


def main() -> None:
    import torch

    if torch.cuda.is_available():
        raise ValueError('Use o ambiente CPU do copiloto; o treino do juiz está usando a GPU.')
    falas = exemplos()
    pasta = treinar.MODELOS / NOME
    pasta.mkdir(parents=True, exist_ok=True)
    manifesto = {'split': 'desenvolvimento-fora-da-parte', 'config': CFG,
                 'falas_sha256': hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                 'formato_sha256': hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest(),
                 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                 'treinador_sha256': hashlib.sha256(Path(treinar.__file__).read_bytes()).hexdigest()}
    caminho_oof = treinar.TREINO / f'oof-{NOME}.jsonl'
    caminho_manifesto = pasta / 'treino.json'
    if caminho_oof.exists() or (pasta / 'torch').exists():
        if not caminho_manifesto.exists() or json.loads(caminho_manifesto.read_text(encoding='utf-8')) != manifesto:
            raise ValueError('Triagem mudou: não retomar resultados obsoletos.')
    caminho_manifesto.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2), encoding='utf-8')
    feitas = {l['parte'] for l in treinar.ler_jsonl(caminho_oof)}
    for k in range(treinar.PARTES):
        if k in feitas:
            continue
        inicio = time.perf_counter()
        treino = [f for f in falas if f['parte'] != k]
        valida = [f for f in falas if f['parte'] == k]
        tok, modelo = treinar._treinar_um(CFG, treino, treinar.ROTULOS_TRIAGEM, None, par=False)
        notas = treinar._pontuar(tok, modelo, valida, par=False, lote=8)
        with caminho_oof.open('a', encoding='utf-8') as saida:
            for f, nota in zip(valida, notas, strict=True):
                saida.write(json.dumps({'id': f['id'], 'grupo': f['grupo'], 'parte': k,
                                        'notas': dict(zip(treinar.ROTULOS_TRIAGEM, nota)),
                                        'alvo': {c: f[c] for c in treinar.ROTULOS_TRIAGEM}}) + '\n')
        print(f'Parte {k}: {len(valida)} frases, {time.perf_counter() - inicio:.1f}s.', flush=True)
        del modelo
    treinar._treinar_um(CFG, falas, treinar.ROTULOS_TRIAGEM, pasta / 'torch', par=False)
    print(f'{len(falas)} frases; triagem semântica treinada nas três partições e no conjunto final de dev.', flush=True)


if __name__ == '__main__':
    main()
