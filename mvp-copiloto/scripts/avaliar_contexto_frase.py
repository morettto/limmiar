"""Diagnóstico de desenvolvimento: sentido da frase atual contra fontes revisadas."""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('MKL_NUM_THREADS', '2')

import treinar
from copiloto import frase


def entrada(fala: str, contexto: list[str], trecho: str) -> str:
    return frase.formato_qwen(fala, contexto, trecho)


def main() -> None:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    fontes = treinar.ler_jsonl(RAIZ / 'data/treino/fontes-dev-revisadas.jsonl')
    ids = {r['id'] for r in fontes}
    pares = [p for p in treinar.pares_claude() if p['id'] in ids and (p['origem'] == 'fonte-dev' or p['alvo'] == 1)]
    casos = {c['id']: c for nome in ('claude-r4.jsonl', 'claude-r5.jsonl') for c in treinar.ler_jsonl(RAIZ / 'data/treino' / nome)}
    escopo = sys.argv[1] if len(sys.argv) > 1 else 'contrastes'
    if escopo not in ('contrastes', 'dev'):
        raise ValueError('Use contrastes ou dev; teste independente não participa deste diagnóstico.')
    for par in pares:
        caso = casos[par['id']]
        par.update(fala=caso['fala'], contexto=caso.get('contexto', []))
    if escopo == 'dev':
        from bench_juiz import pares as pares_benchmark
        pares.extend({**par, 'alvo': int(par['valido'])} for par in pares_benchmark())
    unicos = {}
    for par in pares:
        chave = (par['id'], par['fala'], tuple(par['contexto']), par['trecho'])
        if chave in unicos and unicos[chave]['alvo'] != par['alvo']:
            raise ValueError('Rótulos conflitantes da mesma frase e passagem.')
        unicos[chave] = par
    pares = list(unicos.values())
    nome_dtype = os.environ.get('COPILOTO_DIAGNOSTICO_DTYPE', 'float16')
    destino = RAIZ / f'resultados/diagnostico-frase-atual-qwen/{escopo}-{nome_dtype}'
    destino.mkdir(parents=True, exist_ok=True)
    pasta = RAIZ / 'modelos/hf/Qwen3-Reranker-0.6B-seq-cls'
    tok = AutoTokenizer.from_pretrained(pasta, local_files_only=True, trust_remote_code=True)
    dtype = getattr(torch, nome_dtype)
    modelo = AutoModelForSequenceClassification.from_pretrained(pasta, local_files_only=True, trust_remote_code=True, dtype=dtype)
    dispositivo = 'cuda' if torch.cuda.is_available() else 'cpu'
    modelo = modelo.to(dispositivo).eval()
    registros = []
    for n, par in enumerate(pares):
        texto = entrada(par['fala'], par['contexto'], par['trecho'])
        batch = tok([texto], truncation=False, return_tensors='pt').to(dispositivo)
        if batch['input_ids'].shape[1] > modelo.config.max_position_embeddings:
            raise ValueError('Entrada excede capacidade; não truncar.')
        inicio = time.perf_counter()
        with torch.inference_mode():
            score = torch.sigmoid(modelo(**batch).logits.float()).item()
        registro = {**{k: par[k] for k in ('id', 'arquivo', 'pagina', 'paragrafo', 'alvo', 'origem') if k in par},
                    'fala': par['fala'], 'contexto': par['contexto'], 'trecho_sha256': hashlib.sha256(par['trecho'].encode()).hexdigest(),
                    'score': score, 'ms': round((time.perf_counter() - inicio) * 1000, 1)}
        registros.append(registro)
        if (n + 1) % 20 == 0:
            print(f'{n + 1}/{len(pares)} pares da frase atual', flush=True)
    resumo = {'tipo': 'diagnostico-desenvolvimento', 'validacao_clinica': False, 'dispositivo': dispositivo,
              'dtype': str(dtype), 'escopo': escopo, 'instrucao_sha256': hashlib.sha256(frase.INSTRUCAO.encode()).hexdigest(),
              'revisoes_sha256': hashlib.sha256((RAIZ / 'data/treino/fontes-dev-revisadas.jsonl').read_bytes()).hexdigest(),
              'pares': len(registros), 'limiares_diagnosticos': {}}
    for limiar in (.5, .8, .9, .95, .964, .99):
        aprovados = [r for r in registros if r['score'] >= limiar]
        corretos = sum(r['alvo'] == 1 for r in aprovados)
        resumo['limiares_diagnosticos'][str(limiar)] = {'aprovados': len(aprovados), 'corretos': corretos,
                                                      'falsos': len(aprovados) - corretos}
    (destino / 'registros.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in registros), encoding='utf-8')
    (destino / 'resumo.json').write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(resumo, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
