"""Contexto de autoria por sessão: perfil, turnos e até 25 trechos candidatos de cada um dos 5 materiais."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from passagens import GOLD, carregar, parse, sessoes

MAX_CANDIDATOS = 25
DESCARTE = re.compile(
    r'acknowledg|\bfund(?:ing|ed by)\b|\bgrants?\b|conflicts? of interest|competing interest|author contributions?|'
    r'correspond|\borcid\b|e-?mail|creative commons|\blicen[cs]e|copyright|©|open access|this (?:article|is an)|'
    r'published (?:by|online)|received:|accepted:|data availability|supplementary|ethic(?:s|al) (?:approval|statement|committee)|'
    r'^\s*(?:figure|fig\.|table|box)\s*\d|\bkeywords\b|consent was (?:obtained|given)|approved by|[£€$]\s?\d|\bvol\.?\s*\d|'
    r'[a-z]{30,}|\.tnum\b|(?:\b\w\s){5,}|submit your|manuscript|disclaimer|(?-i:\b[A-Z]{2,}\s?,\s[a-z][^.;]{0,60};)',
    re.IGNORECASE)
CLINICO = re.compile(
    r'\b(?:symptom|patient|client|experienc|feel|emotion|fear|avoid|sleep|worr|thought|memor|behavio|treatment|therap|'
    r'intervention|improv|reduc|associat|mechanism|cop(?:e|ing)|stress|anxi|depress|trauma|distress|relation|daily|'
    r'function|craving|relaps|pain|grief|loss|lonel|shame|guilt|anger|panic|eat|weight|drink|alcohol)\w*',
    re.IGNORECASE)
METODO = re.compile(
    r'\b(?:search(?:ed)?|databases?|risk of bias|validity|psychometric|reliabilit|ICC|CFI|RMSEA|adherence|rated|excluded|'
    r'eligib|assessed using|scales?|items?|questionnaire|recruit|protocol|meta-analys|systematic review|PRISMA|'
    r'significant(?:ly)?|statistic|model|follow-up|sample|baseline|outcome measure|trial)\w*',
    re.IGNORECASE)


def relevancia(texto: str) -> float:
    return (len(CLINICO.findall(texto)) - 2 * len(METODO.findall(texto))) / len(texto.split())


def elegivel(texto: str) -> bool:
    return 250 <= len(texto) <= 1200 and not DESCARTE.search(texto) and parse.motivo_descarte(texto) is None \
        and len(METODO.findall(texto)) < 4


def escolher(trechos: list[dict]) -> list[dict]:
    """Round-robin over pages, most clinical and least methodological first, so candidates cover the whole article."""
    por_pagina: dict[int, list[dict]] = defaultdict(list)
    for trecho in trechos:
        if elegivel(trecho['texto']):
            por_pagina[trecho['pagina']].append(trecho)
    filas = [sorted(itens, key=lambda t: -relevancia(t['texto']))
             for _, itens in sorted(por_pagina.items())]
    escolhidos = []
    while len(escolhidos) < MAX_CANDIDATOS and any(filas):
        for fila in filas:
            if fila and len(escolhidos) < MAX_CANDIDATOS:
                escolhidos.append(fila.pop(0))
    return sorted(escolhidos, key=lambda t: (t['pagina'], t['paragrafo']))


def candidatos(sessao: dict) -> dict:
    cenario = json.loads((Path(sessao['audio_path']).parent / 'scenario.json').read_text(encoding='utf-8'))
    return {
        'sessao': sessao['id'],
        'tema': cenario['theme'],
        'perfil': cenario['patient'],
        'turnos': [{'index': t['index'], 'role': t['role'], 'text': t['text']} for t in cenario['turns']],
        'materiais': [{
            'pmcid': fonte['pmcid'], 'titulo': fonte['title'], 'autores': fonte['authors'],
            'passagens': [{k: t[k] for k in ('trecho_id', 'pagina', 'paragrafo', 'texto')}
                          for t in escolher(list(carregar(fonte['pmcid']).values()))],
        } for fonte in cenario['sources']],
    }


def arquivo(sessao_id: str) -> Path:
    return GOLD / 'candidatos' / f'{sessao_id}.json'


def main() -> None:
    arquivo('_').parent.mkdir(parents=True, exist_ok=True)
    contagens = []
    for sessao in sessoes():
        dados = candidatos(sessao)
        arquivo(sessao['id']).write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding='utf-8')
        contagens.append(sum(len(m['passagens']) for m in dados['materiais']))
    print(f'{len(contagens)} sessões; candidatos por sessão: min {min(contagens)}, max {max(contagens)}')


if __name__ == '__main__':
    main()
