"""Trechos de cada PDF das 100 sessões, cortados pelo mesmo caminho que o copiloto usa ao preparar um material."""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SIM = ROOT / '.local' / 'simulacao-100'
GOLD = ROOT / '.local' / 'claude-goal' / 'gold'
sys.path.insert(0, str(ROOT / 'mvp-copiloto' / 'src'))

from copiloto import acervo_profissional, parse  # noqa: E402,F401


def sessoes() -> list[dict]:
    return json.loads((SIM / 'lote-manifest.json').read_text(encoding='utf-8'))['sessions']


def artigos() -> dict[str, dict]:
    manifest = json.loads((SIM / 'materiais' / 'manifest.json').read_text(encoding='utf-8'))
    return {artigo['pmcid']: artigo for artigo in manifest['articles']}


def arquivo(pmcid: str, pasta: Path = GOLD / 'passagens') -> Path:
    return pasta / f'{pmcid}.jsonl'


def carregar(pmcid: str, pasta: Path = GOLD / 'passagens') -> dict[str, dict]:
    with arquivo(pmcid, pasta).open(encoding='utf-8') as linhas:
        return {row['trecho_id']: row for row in map(json.loads, linhas)}


def extrair(pmcid: str, data: bytes, titulo: str) -> list[dict]:
    # Calls the real ACERVO.preparar so page/paragraph numbering cannot drift from what a card cites.
    # Only the blocks matter here, so the bge-m3 encode and the judge are replaced by zeros.
    zeros = lambda textos, *_, **__: np.zeros((len(textos), 1), dtype=np.float32)  # noqa: E731
    with patch.object(acervo_profissional.embedder, 'codificar_documentos', side_effect=zeros), \
            patch.object(acervo_profissional.juiz_pequeno, 'generico', side_effect=lambda textos: [0.0] * len(textos)):
        material = acervo_profissional.Acervo().preparar('gold', pmcid, data, {
            'titulo': titulo, 'autores': '-', 'tipo': 'pdf', 'sha256': hashlib.sha256(data).hexdigest()})
    return [{'trecho_id': f'{pmcid}:{bloco.pagina}:{bloco.paragrafo}', 'pmcid': pmcid, 'pagina': bloco.pagina,
             'paragrafo': bloco.paragrafo, 'texto': bloco.texto} for bloco in material.blocks]


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--pmcids', type=Path, help='arquivo com um pmcid por linha; sem ele, os materiais das sessões')
    parser.add_argument('--saida', type=Path, default=GOLD / 'passagens')
    args = parser.parse_args(argv)
    catalogo = artigos()
    pmcids = sorted(args.pmcids.read_text(encoding='utf-8').split() if args.pmcids
                    else {fonte['pmcid'] for sessao in sessoes() for fonte in sessao['sources']})
    args.saida.mkdir(parents=True, exist_ok=True)
    gerados = 0
    for pmcid in pmcids:
        artigo = catalogo[pmcid]
        data = Path(artigo['path']).read_bytes()
        if hashlib.sha256(data).hexdigest() != artigo['sha256']:
            raise SystemExit(f'{pmcid}: sha256 do PDF difere do manifest')
        destino = arquivo(pmcid, args.saida)
        if destino.exists():
            continue
        temporario = destino.with_suffix('.tmp')
        temporario.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n'
                                      for row in extrair(pmcid, data, artigo['title'])), encoding='utf-8')
        temporario.replace(destino)
        gerados += 1
    contagens = [len(carregar(pmcid, args.saida)) for pmcid in pmcids]
    print(f'{len(pmcids)} pmcids ({gerados} gerados agora); trechos por pmcid: min {min(contagens)}, '
          f'mediana {statistics.median(contagens)}, max {max(contagens)}')


if __name__ == '__main__':
    main(sys.argv[1:])
