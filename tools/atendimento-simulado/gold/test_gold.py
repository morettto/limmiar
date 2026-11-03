import copy
import json
import unittest

from pontuar import agregar, metas, pontuar_fala, wilson
from validar_gold import validar

PMCIDS = ['PMC1', 'PMC2', 'PMC3', 'PMC4', 'PMC5']
TEXTO = ('Patients often describe waking several times during the night and lying awake with racing thoughts '
         'about work, which leaves them exhausted and irritable the following day.')
TEXTO_PT = 'A ansiedade é constante quando acordo cedo e penso no trabalho que ficou para trás na semana.'
PASSAGENS = {f'{p}:3:1': {'trecho_id': f'{p}:3:1', 'pmcid': p, 'pagina': 3, 'paragrafo': 1,
                          'texto': TEXTO_PT if p == 'PMC5' else TEXTO} for p in PMCIDS + ['PMC9']}
CONTEXTO = {
    'sessao': 'sessao-001',
    'materiais': [{'pmcid': p} for p in PMCIDS],
    'turnos': [{'index': 0, 'role': 'Profissional'}, {'index': 1, 'role': 'Profissional'},
               {'index': 2, 'role': 'Paciente'}, {'index': 3, 'role': 'Profissional'}, {'index': 4, 'role': 'Paciente'}],
}
NEGATIVOS = ['conversa', 'logistica', 'terceiro', 'negacao', 'figurado', 'nega_risco']


def positivo(n: int, pmcid: str) -> dict:
    texto = PASSAGENS[f'{pmcid}:3:1']['texto']
    return {'sessao': 'sessao-001', 'id': f'p{n}', 'tipo': 'positivo', 'subtipo': 'risco' if n == 0 else 'fenomeno',
            'frase': 'Eu acordo de madrugada e fico remoendo as coisas do serviço até o dia clarear.',
            'inserir_apos_turno': 1 if n % 2 else 3,
            'ancora': {'trecho_id': f'{pmcid}:3:1', 'pmcid': pmcid, 'pagina': 3, 'citacao': ' '.join(texto.split()[:8])},
            'justificativa': 'A passagem descreve despertares noturnos com pensamentos acelerados.'}


def gabarito() -> list[dict]:
    rows = [positivo(2 * i + k, p) for i, p in enumerate(PMCIDS) for k in range(2)]
    return rows + [{'sessao': 'sessao-001', 'id': f'n{i}', 'tipo': 'negativo', 'subtipo': s,
                    'frase': 'O trânsito hoje estava parado na avenida inteira.', 'inserir_apos_turno': 3,
                    'justificativa': 'Fala sem conteúdo clínico.'} for i, s in enumerate(NEGATIVOS)]


def erros(rows: list) -> list[str]:
    texto = '\n'.join(row if isinstance(row, str) else json.dumps(row, ensure_ascii=False) for row in rows)
    return validar(texto, CONTEXTO, PASSAGENS)


class ValidadorTest(unittest.TestCase):
    def assertUmErro(self, rows: list, trecho: str):
        resultado = erros(rows)
        self.assertEqual(len(resultado), 1, resultado)
        self.assertIn(trecho, resultado[0])

    def alterado(self, indice: int, mudar) -> list[dict]:
        rows = copy.deepcopy(gabarito())
        mudar(rows[indice])
        return rows

    def test_gabarito_valido_passa(self):
        self.assertEqual(erros(gabarito()), [])

    def test_json_invalido(self):
        self.assertIn('JSON', erros(gabarito() + ['{"sessao": ']).pop())

    def test_tipo_fora_do_enum(self):
        self.assertIn('tipo', erros(self.alterado(10, lambda r: r.update(tipo='neutro')))[0])

    def test_campos_exatos(self):
        self.assertIn('campos', erros(self.alterado(10, lambda r: r.update(ancora=None)))[0])
        self.assertIn('campos', erros(self.alterado(0, lambda r: r.pop('justificativa')))[0])

    def test_subtipo_do_tipo(self):
        self.assertUmErro(self.alterado(1, lambda r: r.update(subtipo='conversa')), 'subtipo')

    def test_dez_positivos_dois_por_material(self):
        self.assertEqual(erros(gabarito()[1:]), ['9 positivos; esperados 10', 'PMC1: 1 positivos; esperados 2'])
        desequilibrado = self.alterado(0, lambda r: r['ancora'].update(trecho_id='PMC2:3:1', pmcid='PMC2'))
        self.assertEqual(erros(desequilibrado), ['PMC1: 1 positivos; esperados 2', 'PMC2: 3 positivos; esperados 2'])

    def test_um_negativo_por_subtipo(self):
        resultado = erros(self.alterado(10, lambda r: r.update(subtipo='logistica')))
        self.assertEqual(len(resultado), 2, resultado)
        self.assertTrue(any('conversa' in e for e in resultado) and any('logistica' in e for e in resultado))

    def test_trecho_inexistente(self):
        self.assertUmErro(self.alterado(0, lambda r: r['ancora'].update(trecho_id='PMC1:99:1')), 'trecho_id')

    def test_pmcid_fora_da_sessao(self):
        resultado = erros(self.alterado(0, lambda r: r['ancora'].update(trecho_id='PMC9:3:1', pmcid='PMC9')))
        self.assertTrue(any('não é um dos 5' in e for e in resultado), resultado)

    def test_pagina_divergente_do_trecho(self):
        self.assertUmErro(self.alterado(0, lambda r: r['ancora'].update(pagina=4)), 'pagina')

    def test_citacao_literal_e_tamanho(self):
        self.assertUmErro(self.alterado(0, lambda r: r['ancora'].update(citacao='Patients often describe waking twice during the night')), 'literal')
        self.assertUmErro(self.alterado(0, lambda r: r['ancora'].update(citacao='Patients often describe')), '6 a 30')

    def test_frase_nao_copia_cinco_palavras_ignorando_acentos(self):
        self.assertUmErro(self.alterado(8, lambda r: r.update(frase='Olha, ansiedade e CONSTANTE quando acordo cedo, sabe?')), 'copia')
        self.assertUmErro(self.alterado(0, lambda r: r.update(frase='Patients often describe waking several times.')), 'copia')

    def test_insercao_apos_fim_de_fala_do_profissional(self):
        for turno in (2, 0, 99, True, '3'):
            with self.subTest(turno=turno):
                self.assertUmErro(self.alterado(0, lambda r: r.update(inserir_apos_turno=turno)), 'inserir_apos_turno')

    def test_ids_unicos_e_sessao(self):
        self.assertUmErro(self.alterado(1, lambda r: r.update(id='p0')), 'id')
        self.assertUmErro(self.alterado(1, lambda r: r.update(sessao='sessao-002')), 'sessao')


def cartao(pmcid: str, pagina: int, probabilidade: float = 0.8) -> dict:
    return {'trecho_id': f'{pmcid}:{pagina}:1', 'pmcid': pmcid, 'pagina': pagina, 'probabilidade': probabilidade,
            'nivel': 'possivel', 'citacao_literal': 'x'}


def resultado(*cartoes, alerta=False, candidatos=(), julgados=(), ms=10.0, chamadas=3) -> dict:
    return {'cartoes': list(cartoes), 'alerta_risco': alerta, 'clarificar': False, 'ms': ms, 'chamadas_juiz': chamadas,
            'candidatos': list(candidatos), 'julgados': list(julgados)}


class PontuacaoTest(unittest.TestCase):
    def setUp(self):
        rows = gabarito()
        self.positivo, self.risco, self.negativo, self.nega_risco = rows[2], rows[0], rows[10], rows[15]
        self.set = set(PMCIDS)

    def test_acerto_estrito_ate_uma_pagina(self):
        perto = pontuar_fala(self.positivo, resultado(cartao('PMC2', 4)), self.set)
        longe = pontuar_fala(self.positivo, resultado(cartao('PMC2', 5)), self.set)
        self.assertTrue(perto['acerto'] and perto['acerto_estrito'])
        self.assertTrue(longe['acerto'])
        self.assertFalse(longe['acerto_estrito'])

    def test_outro_material_do_conjunto_nao_acerta(self):
        fala = pontuar_fala(self.positivo, resultado(cartao('PMC3', 3)), self.set)
        self.assertFalse(fala['acerto'])
        self.assertEqual(fala['fora_do_conjunto'], 0)

    def test_topo_e_o_cartao_de_maior_probabilidade(self):
        fala = pontuar_fala(self.positivo, resultado(cartao('PMC2', 3, 0.75), cartao('PMC3', 3, 0.95)), self.set)
        self.assertTrue(fala['acerto'])
        self.assertFalse(fala['acerto_topo'])
        self.assertTrue(pontuar_fala(self.positivo, resultado(cartao('PMC2', 3, 0.95), cartao('PMC3', 3, 0.75)), self.set)['acerto_topo'])

    def test_negativo_com_cartao_e_falso_positivo_e_fora_do_conjunto_conta(self):
        fala = pontuar_fala(self.negativo, resultado(cartao('PMC9', 3)), self.set)
        self.assertTrue(fala['falso_positivo'])
        self.assertEqual(fala['fora_do_conjunto'], 1)
        self.assertFalse(pontuar_fala(self.negativo, resultado(), self.set)['falso_positivo'])

    def test_risco_exige_alerta_e_negacao_de_risco_exige_silencio(self):
        self.assertTrue(pontuar_fala(self.risco, resultado(alerta=True), self.set)['risco_ok'])
        self.assertFalse(pontuar_fala(self.risco, resultado(), self.set)['risco_ok'])
        self.assertFalse(pontuar_fala(self.nega_risco, resultado(alerta=True), self.set)['risco_ok'])
        self.assertNotIn('risco_ok', pontuar_fala(self.positivo, resultado(alerta=True), self.set))

    def test_agregado(self):
        falas = [
            pontuar_fala(self.positivo, resultado(cartao('PMC2', 3), cartao('PMC4', 3)), self.set),
            pontuar_fala(self.risco, resultado(alerta=True), self.set),
            pontuar_fala(self.negativo, resultado(cartao('PMC1', 3)), self.set),
            pontuar_fala(self.nega_risco, resultado(), self.set),
        ]
        relatorio = agregar(falas)
        self.assertEqual((relatorio['recall']['k'], relatorio['recall']['n']), (1, 2))
        self.assertEqual((relatorio['precisao']['k'], relatorio['precisao']['n']), (1, 3))
        self.assertEqual((relatorio['falso_positivo']['k'], relatorio['falso_positivo']['n']), (1, 2))
        self.assertEqual((relatorio['risco']['k'], relatorio['risco']['n']), (2, 2))
        self.assertEqual(relatorio['por_material']['PMC1']['n'], 1)
        self.assertEqual(relatorio['por_sessao']['sessao-001']['recall']['k'], 1)
        self.assertEqual(relatorio['fora_do_conjunto'], 0)
        temas = relatorio['cobertura_por_tema']
        self.assertEqual((temas['k'], temas['n']), (1, 2), 'cada material da sessão é um tema; um acerto cobre o tema')
        alvo = metas(relatorio)
        self.assertFalse(alvo['precisao']['atende'])
        self.assertTrue(alvo['risco']['atende'])

    def test_busca_diz_onde_a_ancora_se_perde_e_o_custo_separa_as_falas_clinicas(self):
        ancora = self.positivo['ancora']
        outros = [f'PMC9:1:{i}' for i in range(30)]
        na_busca = outros[:25] + [ancora['trecho_id']]
        falas = [pontuar_fala(self.positivo, resultado(candidatos=na_busca, julgados=outros[:6], ms=900.0, chamadas=10), self.set),
                 pontuar_fala(self.positivo, resultado(candidatos=[f'{ancora["pmcid"]}:99:1'], julgados=[f'{ancora["pmcid"]}:99:1'],
                                                       ms=800.0, chamadas=10), self.set),
                 pontuar_fala(self.negativo, resultado(ms=100.0, chamadas=3), self.set)]
        relatorio = agregar(falas)
        busca = relatorio['busca']
        self.assertEqual([busca[k]['k'] for k in ('portao_abriu', 'ancora_na_busca_20', 'ancora_na_busca_40',
                                                  'material_na_busca', 'ancora_julgada', 'material_julgado')], [2, 0, 1, 2, 0, 1])
        self.assertEqual(relatorio['custo']['clinicas']['falas'], 2)
        self.assertEqual(relatorio['custo']['clinicas']['chamadas_llm_por_fala'], 10)
        self.assertEqual(relatorio['custo']['todas']['chamadas_llm_por_fala'], round(23 / 3, 2))
        self.assertEqual(relatorio['custo']['todas']['latencia_ms']['p95'], 900.0)

    def test_wilson(self):
        self.assertEqual(wilson(5, 10)['ic95'], [0.2366, 0.7634])
        self.assertIsNone(wilson(0, 0)['taxa'])
        self.assertEqual(wilson(10, 10)['ic95'][1], 1.0)


if __name__ == '__main__':
    unittest.main()
