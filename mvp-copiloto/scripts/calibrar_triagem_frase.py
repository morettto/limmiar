"""Congela limiares de triagem usando apenas as três partições de desenvolvimento."""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

from treinar import parte
from treinar_triagem_frase import exemplos
from copiloto import frase, metadados, triagem_frase

RECALL_MINIMO = {'clinica': .98, 'risco': .95, 'ambigua': .90}


def selecionar(linhas: list[dict]) -> dict:
    if len({l['id'] for l in linhas}) != len(linhas) or {l['parte'] for l in linhas} != {0, 1, 2}:
        raise ValueError('Triagem exige frases únicas nas três partições.')
    for l in linhas:
        if type(l['parte']) is not int or l['parte'] != parte(l['grupo']):
            raise ValueError('Frase julgada pela partição errada.')
        for campo in RECALL_MINIMO:
            score, alvo = l['notas'][campo], l['alvo'][campo]
            if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError('Pontuação de triagem inválida.')
            if type(alvo) not in (int, float) or alvo not in (0, 1):
                raise ValueError('Rótulo de triagem deve ser binário.')
    resultado = {}
    for campo, recall_minimo in RECALL_MINIMO.items():
        positivos = sum(l['alvo'][campo] for l in linhas)
        negativos = len(linhas) - positivos
        if not positivos or not negativos:
            raise ValueError('Triagem precisa de exemplos positivos e negativos de cada decisão.')
        candidatos = []
        for limiar in sorted({l['notas'][campo] for l in linhas}):
            aprovados = [l for l in linhas if l['notas'][campo] >= limiar]
            verdadeiros = sum(l['alvo'][campo] for l in aprovados)
            falsos = len(aprovados) - verdadeiros
            recall = verdadeiros / positivos
            if recall >= recall_minimo:
                candidatos.append({'limiar': limiar, 'recall': recall, 'falso_positivo': falsos / negativos,
                                    'aprovados': len(aprovados), 'positivos': positivos, 'negativos': negativos})
        if not candidatos:
            raise ValueError(f'Triagem não atende à sensibilidade de desenvolvimento de {campo}.')
        resultado[campo] = min(candidatos, key=lambda c: (c['falso_positivo'], -c['limiar']))
    return resultado


def conferir_desenvolvimento(linhas: list[dict], falas: list[dict], manifesto: dict) -> None:
    digest = hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if manifesto['falas_sha256'] != digest:
        raise ValueError('Frases ou rótulos mudaram depois do treino.')
    esperadas = {f['id']: f for f in falas}
    if len(linhas) != len(esperadas) or {l['id'] for l in linhas} != set(esperadas):
        raise ValueError('Predições não cobrem todo o desenvolvimento.')
    for linha in linhas:
        fala = esperadas[linha['id']]
        if linha['grupo'] != fala['grupo'] or linha['alvo'] != {c: fala[c] for c in RECALL_MINIMO}:
            raise ValueError('Predição usa outro grupo ou rótulo de desenvolvimento.')


def main() -> None:
    nome = sys.argv[1] if len(sys.argv) > 1 else 'triagem-frase'
    if nome not in ('triagem-frase', 'triagem-frase-mmbert', 'triagem-frase-mmbert-r2'):
        raise ValueError('Escolha uma triagem de frase com partições próprias.')
    fonte = RAIZ / f'data/treino/oof-{nome}.jsonl'
    pasta = RAIZ / f'modelos/juiz-local/{nome}'
    manifesto = json.loads((pasta / 'treino.json').read_text(encoding='utf-8'))
    if manifesto['formato_sha256'] != hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest():
        raise ValueError('A entrada mudou depois do treino da triagem.')
    if nome == 'triagem-frase' and manifesto['entrada_sha256'] != hashlib.sha256(Path(triagem_frase.__file__).read_bytes()).hexdigest():
        raise ValueError('A representação mudou depois do treino da triagem.')
    linhas = [json.loads(l) for l in fonte.read_text(encoding='utf-8').splitlines() if l.strip()]
    conferir_desenvolvimento(linhas, exemplos(), manifesto)
    if nome.startswith('triagem-frase-mmbert'):
        pesos = pasta / 'torch/model.safetensors'
        if not pesos.is_file() or not (pasta / 'torch/config.json').is_file():
            raise ValueError('Os pesos finais da triagem ainda não foram produzidos.')
        arquivos = (pasta / 'torch').glob('*')
    else:
        pesos = pasta / 'logistica.npz'
        if not pesos.is_file():
            raise ValueError('Os pesos finais da triagem ainda não foram produzidos.')
        arquivos = [pesos]
    resultado = {'split': 'desenvolvimento-fora-da-parte', 'validacao_clinica': False,
                 'oof_sha256': hashlib.sha256(fonte.read_bytes()).hexdigest(),
                 'model_hashes': metadados.hashes(arquivos),
                 'selecionados': selecionar(linhas), 'manifesto': manifesto}
    destino = RAIZ / f'resultados/calibracao-{nome}.json'
    destino.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(resultado['selecionados'], ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
