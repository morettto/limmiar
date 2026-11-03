"""Valida o gabarito por construção de cada sessão (.local/claude-goal/gold/sessoes/sessao-XXX.jsonl)."""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter
from functools import cache

from candidatos import arquivo as arquivo_candidatos
from passagens import GOLD, carregar, sessoes

SUBTIPOS = {
    'positivo': ('fenomeno', 'risco'),
    'negativo': ('conversa', 'logistica', 'terceiro', 'negacao', 'figurado', 'nega_risco'),
}
CAMPOS = {'sessao', 'id', 'tipo', 'subtipo', 'frase', 'inserir_apos_turno', 'justificativa'}
CAMPOS_ANCORA = {'trecho_id', 'pmcid', 'pagina', 'citacao'}
POSITIVOS_POR_MATERIAL = 2


def palavras(texto: str) -> list[str]:
    sem_acento = ''.join(c for c in unicodedata.normalize('NFKD', texto.lower()) if not unicodedata.combining(c))
    return re.findall(r'\w+', sem_acento)


def ngramas(texto: str, n: int = 5) -> set[tuple[str, ...]]:
    tokens = palavras(texto)
    return {tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def turnos_validos(turnos: list[dict]) -> set[int]:
    """A professional turn whose next turn is not professional, so the insertion never splits a therapist line."""
    return {t['index'] for atual, t in enumerate(turnos)
            if t['role'] == 'Profissional' and (atual + 1 == len(turnos) or turnos[atual + 1]['role'] != 'Profissional')}


def _texto(valor) -> bool:
    return isinstance(valor, str) and bool(valor.strip())


def _erros_ancora(row: dict, pmcids: set[str], passagens: dict[str, dict]) -> list[str]:
    ancora = row['ancora']
    if not isinstance(ancora, dict) or set(ancora) != CAMPOS_ANCORA \
            or not all(isinstance(ancora[k], str) for k in ('trecho_id', 'pmcid')):
        return [f'ancora precisa exatamente de {sorted(CAMPOS_ANCORA)}, com trecho_id e pmcid em texto']
    if ancora['pmcid'] not in pmcids:
        return [f'ancora.pmcid {ancora["pmcid"]} não é um dos 5 materiais da sessão']
    trecho = passagens.get(ancora['trecho_id'])
    if trecho is None:
        return [f'ancora.trecho_id {ancora["trecho_id"]} não existe nas passagens']
    erros = []
    if trecho['pmcid'] != ancora['pmcid'] or trecho['pagina'] != ancora['pagina']:
        erros.append(f'ancora.pmcid/pagina não batem com {ancora["trecho_id"]}')
    citacao = ancora['citacao']
    if not isinstance(citacao, str) or not 6 <= len(citacao.split()) <= 30:
        erros.append('ancora.citacao precisa ter de 6 a 30 palavras')
    elif citacao not in trecho['texto']:
        erros.append('ancora.citacao não é trecho literal da passagem')
    comum = ngramas(row['frase']) & ngramas(trecho['texto'])
    if comum:
        erros.append(f'frase copia a passagem (5 palavras em comum: "{" ".join(sorted(comum)[0])}")')
    return erros


def validar(texto: str, contexto: dict, passagens: dict[str, dict]) -> list[str]:
    pmcids = {m['pmcid'] for m in contexto['materiais']}
    permitidos = turnos_validos(contexto['turnos'])
    erros: list[str] = []
    ids: set[str] = set()
    por_material: Counter[str] = Counter()
    negativos: Counter[str] = Counter()
    positivos = 0
    for numero, linha in enumerate(texto.splitlines(), 1):
        if not linha.strip():
            continue
        try:
            row = json.loads(linha)
        except json.JSONDecodeError as erro:
            erros.append(f'linha {numero}: JSON inválido ({erro.msg})')
            continue
        tipo = row.get('tipo') if isinstance(row, dict) else None
        if tipo not in SUBTIPOS:
            erros.append(f'linha {numero}: tipo precisa ser positivo ou negativo')
            continue
        esperados = CAMPOS | {'ancora'} if tipo == 'positivo' else CAMPOS
        if set(row) != esperados:
            erros.append(f'linha {numero}: campos precisam ser exatamente {sorted(esperados)}')
            continue
        local = []
        if row['sessao'] != contexto['sessao']:
            local.append(f'sessao {row["sessao"]!r} difere de {contexto["sessao"]}')
        if not _texto(row['id']) or row['id'] in ids:
            local.append(f'id {row["id"]!r} vazio ou repetido')
        else:
            ids.add(row['id'])
        if row['subtipo'] not in SUBTIPOS[tipo]:
            local.append(f'subtipo {row["subtipo"]!r} inválido para {tipo}')
        if not _texto(row['frase']) or not _texto(row['justificativa']):
            local.append('frase e justificativa precisam ser texto não vazio')
            erros.extend(f'linha {numero}: {e}' for e in local)
            continue
        turno = row['inserir_apos_turno']
        if type(turno) is not int or turno not in permitidos:
            local.append(f'inserir_apos_turno {turno!r} não é o último turno de uma fala do profissional')
        if tipo == 'positivo':
            positivos += 1
            local.extend(_erros_ancora(row, pmcids, passagens))
            if isinstance(row['ancora'], dict) and isinstance(row['ancora'].get('pmcid'), str):
                por_material[row['ancora']['pmcid']] += 1
        elif row['subtipo'] in SUBTIPOS['negativo']:
            negativos[row['subtipo']] += 1
        erros.extend(f'linha {numero}: {e}' for e in local)
    if positivos != POSITIVOS_POR_MATERIAL * len(pmcids):
        erros.append(f'{positivos} positivos; esperados {POSITIVOS_POR_MATERIAL * len(pmcids)}')
    for pmcid in sorted(pmcids):
        if por_material[pmcid] != POSITIVOS_POR_MATERIAL:
            erros.append(f'{pmcid}: {por_material[pmcid]} positivos; esperados {POSITIVOS_POR_MATERIAL}')
    for subtipo in SUBTIPOS['negativo']:
        if negativos[subtipo] != 1:
            erros.append(f'negativo {subtipo}: {negativos[subtipo]}; esperado 1')
    return erros


@cache
def todas_passagens() -> dict[str, dict]:
    pmcids = {fonte['pmcid'] for sessao in sessoes() for fonte in sessao['sources']}
    return {trecho_id: row for pmcid in pmcids for trecho_id, row in carregar(pmcid).items()}


def validar_sessao(sessao_id: str) -> list[str]:
    contexto = json.loads(arquivo_candidatos(sessao_id).read_text(encoding='utf-8'))
    return validar((GOLD / 'sessoes' / f'{sessao_id}.jsonl').read_text(encoding='utf-8'), contexto, todas_passagens())


def main(argv: list[str]) -> int:
    alvos = argv or sorted(p.stem for p in (GOLD / 'sessoes').glob('sessao-*.jsonl'))
    invalidas = 0
    for sessao_id in alvos:
        erros = validar_sessao(sessao_id)
        invalidas += bool(erros)
        for erro in erros:
            print(f'{sessao_id}: {erro}')
    print(f'{len(alvos) - invalidas}/{len(alvos)} sessões válidas ({len(alvos)} de {len(sessoes())} com gabarito)')
    return 1 if invalidas or not alvos else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
