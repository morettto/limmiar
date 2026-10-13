"""Compara vetores bibliográficos armazenados com uma recodificação literal."""
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
sys.path.insert(0, str(RAIZ / 'src'))

from copiloto import embedder
from copiloto.esquema import CAMINHO_BD


def main():
    import numpy as np
    import torch

    torch.set_num_threads(2)
    con = sqlite3.connect(f'file:{CAMINHO_BD.as_posix()}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute('select o.arquivo,o.modelo,t.pagina,t.paragrafo,t.texto,t.embedding '
        'from trecho t join obra o on o.id=t.obra_id where o.status="pronto" and t.embedding is not null order by o.arquivo,t.pagina,t.paragrafo').fetchall()
    con.close()
    chosen, files = [], set()
    for row in rows:
        if row['arquivo'] not in files:
            chosen.append(row)
            files.add(row['arquivo'])
    if not chosen or {r['modelo'] for r in chosen} != {embedder.PADRAO}:
        raise ValueError('Acervo não possui um modelo bibliográfico único.')
    encoded = embedder.codificar_documentos([r['texto'] for r in chosen], lote=4)
    stored = np.vstack([np.frombuffer(r['embedding'], dtype=np.float32) for r in chosen])
    if encoded.shape != stored.shape or not np.isfinite(stored).all():
        raise ValueError('Vetores incompatíveis.')
    cosine = np.einsum('ij,ij->i', encoded, stored) / (np.linalg.norm(encoded, axis=1) * np.linalg.norm(stored, axis=1))
    result = {'validacao_clinica': False, 'modelo': embedder.PADRAO, 'obras': len(chosen),
        'cosine_min': float(cosine.min()), 'cosine_median': float(np.median(cosine)),
        'amostras': [{'arquivo': r['arquivo'], 'pagina': r['pagina'], 'paragrafo': r['paragrafo'],
            'texto_sha256': hashlib.sha256(r['texto'].encode()).hexdigest(), 'cosine': float(c)} for r, c in zip(chosen, cosine, strict=True)]}
    (RAIZ / 'resultados/conferencia-embeddings-acervo-dev.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'amostras'}, indent=2), flush=True)


if __name__ == '__main__':
    main()
