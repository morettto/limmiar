from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gerar import motivo_rejeicao  # noqa: E402
from treinar import dividir, validacao  # noqa: E402
from verificar import filtrar, montar  # noqa: E402

TRECHO = 'Patients with insomnia often report lying awake for hours with racing thoughts before they finally fall asleep.'
FRASE = 'Faz meses que eu deito e fico rolando na cama até umas três da manhã, a cabeça não desliga de jeito nenhum.'


def test_rejeita_fala_curta_copiada_ou_com_rotulo_de_persona():
    assert motivo_rejeicao(FRASE, TRECHO) is None
    assert motivo_rejeicao('Eu não durmo bem.', TRECHO) == '4 palavras'
    copiada = 'Eu acho que lying awake for hours with racing thoughts descreve bem como eu fico toda noite em casa.'
    assert motivo_rejeicao(copiada, TRECHO) == 'copia 5 palavras do trecho'
    assert motivo_rejeicao('2) Mulher, 52 anos, dona de casa: ' + FRASE, TRECHO) == 'rótulo de persona'


def test_filtro_mantem_so_o_que_o_professor_confirma_com_folga():
    base = {'frase': FRASE, 'trecho': TRECHO, 'tipo': 'x', 'pmcid_frase': 'A', 'pmcid_trecho': 'A'}
    notas = [base | {'rotulo_construcao': 1, 'nota_professor': 0.85}, base | {'rotulo_construcao': 1, 'nota_professor': 0.7},
             base | {'rotulo_construcao': 0, 'nota_professor': 0.1}, base | {'rotulo_construcao': 0, 'nota_professor': 0.3},
             base | {'rotulo_construcao': 0, 'nota_professor': None}]
    assert [(m['rotulo'], m['nota_professor']) for m in filtrar(notas)] == [(1, 0.85), (0, 0.1)]


def test_pares_cruzados_vem_do_mesmo_artigo_e_do_mesmo_tema():
    corpus = [{'trecho_id': f'{p}:1:{i}', 'pmcid': p, 'tema': 'insonia', 'texto': f'{p} {i}'}
              for p in ('A', 'B') for i in range(2)]
    geracao = [{'trecho_id': 'A:1:0', 'pmcid': 'A', 'tema': 'insonia', 'positivos': ['p1', 'p2', 'p3'],
                'negativos': {'negacao': 'n'}},
               {'trecho_id': 'A:1:1', 'pmcid': 'A', 'tema': 'insonia', 'erro': 'sem vivência'},
               {'trecho_id': 'B:1:0', 'pmcid': 'B', 'tema': 'insonia', 'positivos': ['q1'], 'negativos': {}}]
    pares = montar(geracao, [{'indice': 0, 'subtipo': 'logistica', 'falas': ['remarcar']}], corpus)
    tipos = {(p['frase'], p['tipo'], p['trecho_id']) for p in pares}
    assert ('p1', 'positivo', 'A:1:0') in tipos and ('n', 'negacao', 'A:1:0') in tipos
    assert not any(t == 'mesmo_artigo' for _, t, _ in tipos), 'A:1:1 failed generation, so A has no other usable passage'
    assert {(f, i) for f, t, i in tipos if t == 'mesmo_tema'} == {('p1', 'B:1:0'), ('p2', 'B:1:0'), ('q1', 'A:1:0')}
    assert {i for f, t, i in tipos if t == 'logistica'} == {'A:1:0', 'B:1:0'}


def test_divisao_por_artigo_descarta_pares_mistos():
    dentro = next(p for p in (f'PMC{i}' for i in range(1000)) if validacao(p))
    fora = next(p for p in (f'PMC{i}' for i in range(1000)) if not validacao(p))
    pares = [{'pmcid_trecho': fora, 'pmcid_frase': fora}, {'pmcid_trecho': dentro, 'pmcid_frase': None},
             {'pmcid_trecho': fora, 'pmcid_frase': dentro}]
    treino, valida = dividir(pares)
    assert treino == pares[:1] and valida == pares[1:2]
