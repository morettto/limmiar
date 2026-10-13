"""Aplica decisões de desenvolvimento sobre uma passagem e frase determinadas."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import frase

PROTOCOLO = 'frase-fenomeno-explicito-v2'


def aplicar(pares: list[dict], arquivo: Path) -> list[dict]:
    por_chave = {(p['id'], p['arquivo'], p['pagina'], p['paragrafo']): p for p in pares}
    decisoes = {}
    for texto in arquivo.read_text(encoding='utf-8').splitlines():
        if not texto.strip():
            continue
        r = json.loads(texto)
        chave = (r['id'], r['arquivo'], r['pagina'], r['paragrafo'])
        p = por_chave.get(chave)
        if chave in decisoes or p is None or r['id'].startswith(('teste', 'final')):
            raise ValueError('Revisão duplicada ou fora do desenvolvimento.')
        if (r['protocolo'] != PROTOCOLO or type(r['valido']) is not bool
                or not isinstance(r['justificativa'], str) or not r['justificativa'].strip()
                or not isinstance(r['revisor'], str) or not r['revisor'].strip()):
            raise ValueError('Revisão exige protocolo, decisão estrita e justificativa.')
        if (r['fala_sha256'] != hashlib.sha256(frase.consulta(p['fala'], p['contexto']).encode()).hexdigest()
                or r['trecho_sha256'] != hashlib.sha256(p['trecho'].encode()).hexdigest()
                or r['grupo'] != p['grupo'] or type(r['parte']) is not int or r['parte'] != p['parte']
                or type(r['alvo_anterior']) not in (int, float) or r['alvo_anterior'] != p['alvo']):
            raise ValueError('Frase, passagem, partição ou rótulo anterior mudou após revisão.')
        citacao, ancora = r['citacao_literal'], r['ancora_na_fala']
        if not isinstance(citacao, str) or not isinstance(ancora, str):
            raise ValueError('Âncora e citação devem ser texto.')
        if r['valido']:
            if (len(citacao.split()) < 6 or citacao not in p['trecho'] or not ancora.strip()
                    or ancora not in p['fala'] or not isinstance(r['fenomeno'], str) or not r['fenomeno'].strip()):
                raise ValueError('Fonte válida exige fenômeno explícito e citação literal da passagem.')
        elif citacao or ancora or r['fenomeno']:
            raise ValueError('Fonte inválida não recebe citação ou fenômeno inventado.')
        decisoes[chave] = r
    return [{**p, 'alvo': float(r['valido']), 'origem': 'fonte-dev', 'rotulo_revisado': True,
             'protocolo_revisao': PROTOCOLO} if (r := decisoes.get((p['id'], p['arquivo'], p['pagina'], p['paragrafo']))) else p
            for p in pares]
