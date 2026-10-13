import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from copiloto import frase, revisao_fontes


class RevisaoFontes(unittest.TestCase):
    def setUp(self):
        self.p = {'id': 'dev-pos-0001', 'arquivo': 'fonte.pdf', 'pagina': 2, 'paragrafo': 3,
                  'grupo': 'dev-pos-0001', 'parte': 0, 'fala': 'A dor não passou depois da lesão.',
                  'contexto': [], 'trecho': 'Algumas pessoas sentem dor que não passa depois de uma lesão.',
                  'alvo': 0., 'origem': 'adjudicacao'}
        self.r = {k: self.p[k] for k in ('id', 'arquivo', 'pagina', 'paragrafo', 'grupo', 'parte')}
        self.r.update({'protocolo': revisao_fontes.PROTOCOLO, 'valido': True, 'alvo_anterior': 0.,
                       'justificativa': 'A persistência da dor está explicitamente expressa.', 'revisor': 'Codex',
                       'fala_sha256': hashlib.sha256(frase.consulta(self.p['fala'], []).encode()).hexdigest(),
                       'trecho_sha256': hashlib.sha256(self.p['trecho'].encode()).hexdigest(),
                       'citacao_literal': 'dor que não passa depois de uma lesão.',
                       'ancora_na_fala': 'A dor não passou', 'fenomeno': 'Persistência da dor'})

    def aplicar(self, revisoes):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = Path(pasta) / 'revisoes.jsonl'
            caminho.write_text(''.join(json.dumps(r) + '\n' for r in revisoes), encoding='utf-8')
            return revisao_fontes.aplicar([self.p], caminho)

    def test_alternativa_se_aplica_ao_fenomeno_dito_com_hash_e_citacao_exatos(self):
        revisada = self.aplicar([self.r])[0]
        self.assertEqual(revisada['alvo'], 1.)
        self.assertEqual(revisada['origem'], 'fonte-dev')
        self.assertEqual(revisada['parte'], self.p['parte'])
        self.assertEqual(revisada['grupo'], self.p['grupo'])
        self.assertEqual(self.p['alvo'], 0.)
        self.assertEqual(self.aplicar([]), [self.p])

    def test_recusa_modificacoes_que_desvinculam_a_revisao_do_alvo_literal(self):
        alteracoes = {'valido': 'true', 'protocolo': 'desconhecido', 'justificativa': '', 'revisor': '',
                      'fala_sha256': 'outro', 'trecho_sha256': 'outro', 'grupo': 'outro', 'parte': 1,
                      'alvo_anterior': 1., 'citacao_literal': 'A dor está resolvida e não é mais um problema.',
                      'ancora_na_fala': 'Sou outra pessoa', 'fenomeno': '', 'id': 'teste-0001'}
        for campo, valor in alteracoes.items():
            with self.subTest(campo=campo), self.assertRaises(ValueError):
                self.aplicar([{**self.r, campo: valor}])
        with self.assertRaises(ValueError):
            self.aplicar([self.r, self.r])

    def test_negativo_nao_recebe_citacao_ou_fenomeno_inventado(self):
        negativa = {**self.r, 'valido': False, 'citacao_literal': '', 'ancora_na_fala': '', 'fenomeno': ''}
        self.assertEqual(self.aplicar([negativa])[0]['alvo'], 0.)
        for campo in ('citacao_literal', 'ancora_na_fala', 'fenomeno'):
            with self.subTest(campo=campo), self.assertRaises(ValueError):
                self.aplicar([{**negativa, campo: self.r[campo]}])


if __name__ == '__main__':
    unittest.main()
