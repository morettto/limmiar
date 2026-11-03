"""Pontua os cartões do copiloto contra o gabarito por construção.

Entrada: JSONL com uma linha por fala desenhada, {sessao, id, cartoes: [{trecho_id, pmcid, pagina, probabilidade,
nivel, citacao_literal}], alerta_risco, clarificar, ms, chamadas_juiz, candidatos, julgados}; candidatos é a ordem da busca
e julgados são os trechos que o professor julgou, ambos vazios quando o portão calou. Saída: relatório JSON no stdout.
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from candidatos import arquivo as arquivo_candidatos
from passagens import GOLD
from validar_gold import validar_sessao

Z95 = 1.959964
PROFUNDIDADES = (6, 20, 40)
# The bar a top-tier clinical product holds (owner, 2026-10-21): a wrong card costs more trust than a silent one,
# and a theme the session's material covers must surface at least once per session.
METAS = {'precisao': ('>=', 0.95), 'falso_positivo': ('<=', 0.02), 'recall': ('>=', 0.70),
         'cobertura_por_tema': ('>=', 0.90), 'risco': ('>=', 1.0), 'latencia_p95_clinica_ms': ('<=', 3000)}


def wilson(acertos: int, total: int) -> dict:
    if total == 0:
        return {'k': 0, 'n': 0, 'taxa': None, 'ic95': None}
    p = acertos / total
    base = 1 + Z95 ** 2 / total
    centro = (p + Z95 ** 2 / (2 * total)) / base
    margem = Z95 * math.sqrt(p * (1 - p) / total + Z95 ** 2 / (4 * total ** 2)) / base
    return {'k': acertos, 'n': total, 'taxa': round(p, 4), 'ic95': [round(centro - margem, 4), round(centro + margem, 4)]}


def _material(trecho_id: str) -> str:
    return trecho_id.split(':', 1)[0]


def pontuar_fala(gold: dict, resultado: dict, pmcids: set[str]) -> dict:
    cartoes = resultado['cartoes']
    fala = {'sessao': gold['sessao'], 'id': gold['id'], 'tipo': gold['tipo'], 'subtipo': gold['subtipo'],
            'cartoes': len(cartoes), 'fora_do_conjunto': sum(c['pmcid'] not in pmcids for c in cartoes),
            'ms': resultado['ms'], 'chamadas_juiz': resultado['chamadas_juiz'], 'buscou': bool(resultado['candidatos'])}
    if gold['tipo'] == 'positivo':
        ancora = gold['ancora']
        candidatos, julgados = resultado['candidatos'], resultado['julgados']
        fala |= {f'ancora_na_busca_{k}': ancora['trecho_id'] in candidatos[:k] for k in PROFUNDIDADES}
        fala |= {'material_na_busca': ancora['pmcid'] in map(_material, candidatos),
                 'ancora_julgada': ancora['trecho_id'] in julgados,
                 'material_julgado': ancora['pmcid'] in map(_material, julgados)}
        certos = [c for c in cartoes if c['pmcid'] == ancora['pmcid']]
        topo = max(cartoes, key=lambda c: c['probabilidade'], default=None)
        fala |= {'pmcid': ancora['pmcid'], 'acerto': bool(certos), 'cartoes_certos': len(certos),
                 'acerto_estrito': any(abs(c['pagina'] - ancora['pagina']) <= 1 for c in certos),
                 'acerto_topo': topo is not None and topo['pmcid'] == ancora['pmcid']}
    else:
        fala |= {'falso_positivo': bool(cartoes), 'cartoes_certos': 0}
    if gold['subtipo'] in ('risco', 'nega_risco'):
        fala['risco_ok'] = resultado['alerta_risco'] is (gold['subtipo'] == 'risco')
    return fala


def _recall(falas: list[dict]) -> dict:
    return wilson(sum(f['acerto'] for f in falas), len(falas))


def _pct(valores: list[float], p: float) -> float | None:
    return sorted(valores)[min(len(valores) - 1, int(p * len(valores)))] if valores else None


def _custo(falas: list[dict]) -> dict:
    return {'falas': len(falas), 'chamadas_llm_por_fala': round(sum(f['chamadas_juiz'] for f in falas) / len(falas), 2)
            if falas else None, 'latencia_ms': {'p50': _pct([f['ms'] for f in falas], .5),
                                                'p95': _pct([f['ms'] for f in falas], .95)}}


def _busca(positivos: list[dict]) -> dict:
    """Where the anchor is lost: the gate, the retrieval depth, or the student's cut to the judged passages."""
    contar = lambda chave: wilson(sum(f[chave] for f in positivos), len(positivos))  # noqa: E731
    return {'portao_abriu': contar('buscou'), **{f'ancora_na_busca_{k}': contar(f'ancora_na_busca_{k}') for k in PROFUNDIDADES},
            'material_na_busca': contar('material_na_busca'), 'ancora_julgada': contar('ancora_julgada'),
            'material_julgado': contar('material_julgado')}


def agregar(falas: list[dict]) -> dict:
    positivos = [f for f in falas if f['tipo'] == 'positivo']
    negativos = [f for f in falas if f['tipo'] == 'negativo']
    risco = [f for f in falas if 'risco_ok' in f]
    return {
        'recall': _recall(positivos),
        'recall_estrito': wilson(sum(f['acerto_estrito'] for f in positivos), len(positivos)),
        'acerto_topo': wilson(sum(f['acerto_topo'] for f in positivos), len(positivos)),
        'precisao': wilson(sum(f['cartoes_certos'] for f in falas), sum(f['cartoes'] for f in falas)),
        'falso_positivo': wilson(sum(f['falso_positivo'] for f in negativos), len(negativos)),
        'falso_positivo_por_subtipo': {k: wilson(sum(f['falso_positivo'] for f in v), len(v))
                                       for k, v in sorted(_grupos('subtipo', negativos).items())},
        'fora_do_conjunto': sum(f['fora_do_conjunto'] for f in falas),
        'risco': wilson(sum(f['risco_ok'] for f in risco), len(risco)),
        'busca': _busca(positivos),
        'custo': {'todas': _custo(falas), 'clinicas': _custo([f for f in falas if f['buscou']])},
        'por_sessao': {k: {'recall': _recall([f for f in v if f['tipo'] == 'positivo']),
                           'falso_positivo': wilson(sum(f.get('falso_positivo', False) for f in v),
                                                    sum(f['tipo'] == 'negativo' for f in v))}
                       for k, v in sorted(_grupos('sessao', falas).items())},
        'por_material': {k: _recall(v) for k, v in sorted(_grupos('pmcid', positivos).items())},
        'cobertura_por_tema': _por_tema(positivos),
    }


def _por_tema(positivos: list[dict]) -> dict:
    """A theme is one material inside one session: covered when any of its statements got a right card."""
    temas = defaultdict(bool)
    for f in positivos:
        temas[(f['sessao'], f['pmcid'])] |= f['acerto']
    return wilson(sum(temas.values()), len(temas))


def metas(dados: dict) -> dict:
    valores = {chave: dados[chave]['taxa'] for chave in ('precisao', 'falso_positivo', 'recall', 'cobertura_por_tema', 'risco')}
    valores['latencia_p95_clinica_ms'] = dados['custo']['clinicas']['latencia_ms']['p95']
    return {chave: {'valor': valores[chave], 'meta': f'{op} {alvo}',
                    'atende': valores[chave] is not None and (valores[chave] >= alvo if op == '>=' else valores[chave] <= alvo)}
            for chave, (op, alvo) in METAS.items()}


def _grupos(chave: str, falas: list[dict]) -> dict[str, list[dict]]:
    grupos = defaultdict(list)
    for fala in falas:
        grupos[fala[chave]].append(fala)
    return grupos


def relatorio(caminho: Path) -> tuple[dict | None, list[str]]:
    resultados = defaultdict(dict)
    for linha in caminho.read_text(encoding='utf-8').splitlines():
        if linha.strip():
            row = json.loads(linha)
            resultados[row['sessao']][row['id']] = row
    erros, falas = [], []
    for sessao_id, por_id in sorted(resultados.items()):
        if invalido := validar_sessao(sessao_id):
            erros += [f'{sessao_id}: gabarito inválido: {e}' for e in invalido]
            continue
        pmcids = {m['pmcid'] for m in json.loads(arquivo_candidatos(sessao_id).read_text(encoding='utf-8'))['materiais']}
        linhas = (GOLD / 'sessoes' / f'{sessao_id}.jsonl').read_text(encoding='utf-8').splitlines()
        gold = {row['id']: row for row in (json.loads(linha) for linha in linhas if linha.strip())}
        if faltam := sorted(gold.keys() ^ por_id.keys()):
            erros.append(f'{sessao_id}: ids sem par entre gabarito e resultados: {faltam}')
            continue
        falas += [pontuar_fala(gold[i], por_id[i], pmcids) for i in sorted(gold)]
    if erros:
        return None, erros
    dados = {'falas': len(falas), **agregar(falas)}
    return {**dados, 'metas': metas(dados)}, []


def main(argv: list[str]) -> int:
    dados, erros = relatorio(Path(argv[0]))
    if erros:
        print('\n'.join(erros), file=sys.stderr)
        return 1
    print(json.dumps(dados, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
