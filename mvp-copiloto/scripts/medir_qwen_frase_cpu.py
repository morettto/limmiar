"""Mede inferência FP32 local do modelo base, sem avaliar nem publicar qualidade."""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from copiloto import frase


def main() -> None:
    import numpy as np
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.set_num_threads(4)
    origem = treinar.HF / 'Qwen3-Reranker-0.6B-seq-cls'
    tok = AutoTokenizer.from_pretrained(origem, local_files_only=True)
    modelo = AutoModelForSequenceClassification.from_pretrained(origem, local_files_only=True, dtype=torch.float32).to('cpu').eval()
    pares, _ = treinar.conjunto_dev()
    pares = treinar.rotulos_revisados(pares)
    selecionados = sorted(pares, key=lambda p: hashlib.sha256((p['id'] + p['trecho']).encode()).hexdigest())[:32]
    textos = [frase.formato_qwen(p['fala'], p['contexto'], p['trecho']) for p in selecionados]
    medidas = []
    for threads in (2, 4, 8):
        torch.set_num_threads(threads)
        for lote in (1, 4, 8):
            tempos, comprimentos = [], []
            for i in range(0, len(textos), lote):
                enc = tok(textos[i:i + lote], padding=True, truncation=False, return_tensors='pt')
                if enc['input_ids'].shape[1] > modelo.config.max_position_embeddings:
                    raise ValueError('Entrada excedeu capacidade; não medir com truncamento.')
                inicio = time.perf_counter()
                with torch.inference_mode():
                    saida = modelo(**enc).logits
                if not torch.isfinite(saida).all():
                    raise ValueError('Inferência não finita.')
                tempos.append(time.perf_counter() - inicio)
                comprimentos.append(enc['input_ids'].shape[1])
            medida = {'threads': threads, 'lote': lote, 'pares': len(textos),
                'lote_p50_s': float(np.median(tempos)), 'lote_p95_s': float(np.quantile(tempos, .95)),
                'pares_por_segundo': len(textos) / sum(tempos), 'max_tokens': max(comprimentos)}
            medidas.append(medida)
            print(json.dumps(medida), flush=True)
    (RAIZ / 'resultados/qwen-frase-cpu-fp32-base.json').write_text(json.dumps({
        'tipo': 'latencia-modelo-base', 'validacao_clinica': False, 'dispositivo': 'cpu',
        'torch': torch.__version__, 'formulacao_sha256': hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest(),
        'truncation': False, 'medidas': medidas}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
