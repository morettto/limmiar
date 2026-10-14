import copy
import hashlib
import json
import unittest

from calibrar_triagem_frase import conferir_desenvolvimento, selecionar
from treinar import parte


class CalibracaoTriagemFrase(unittest.TestCase):
    def linhas(self):
        grupos = {}
        n = 0
        while len(grupos) < 3:
            grupo = f'dev-{n}'
            grupos[parte(grupo)] = grupo
            n += 1
        return [{'id': f'{g}-{alvo}', 'grupo': g, 'parte': k,
                 'alvo': dict.fromkeys(('clinica', 'risco', 'ambigua'), float(alvo)),
                 'notas': dict.fromkeys(('clinica', 'risco', 'ambigua'), .95 if alvo else .02)}
                for k, g in grupos.items() for alvo in (0, 1)]

    def test_seleciona_sensibilidade_fora_da_particao_sem_tocar_teste(self):
        selecionados = selecionar(self.linhas())
        for medicao in selecionados.values():
            self.assertEqual(medicao['recall'], 1.0)
            self.assertEqual(medicao['falso_positivo'], 0.0)
            self.assertEqual(medicao['limiar'], .95)

    def test_recusa_particao_incompleta_duplicacao_rotulo_e_pontuacao_invalidos(self):
        linhas = self.linhas()
        with self.assertRaisesRegex(ValueError, 'partições'):
            selecionar(linhas + [linhas[0]])
        with self.assertRaisesRegex(ValueError, 'partições'):
            selecionar([l for l in linhas if l['parte'] != 0])
        for campo, valor, mensagem in [('parte', (linhas[0]['parte'] + 1) % 3, 'errada'), ('notas', {'clinica': float('nan')}, 'inválida'),
                                       ('alvo', {'clinica': True}, 'binário')]:
            modificadas = copy.deepcopy(linhas)
            modificadas[0][campo] = valor
            with self.assertRaisesRegex(ValueError, mensagem):
                selecionar(modificadas)

    def test_nao_arredonda_probabilidades_pequenas_ao_calibrar_sensibilidade(self):
        linhas = self.linhas()
        for linha in linhas:
            linha['notas'] = dict.fromkeys(('clinica', 'risco', 'ambigua'), .00003 if linha['alvo']['risco'] else .000001)
        for medida in selecionar(linhas).values():
            self.assertEqual(medida['limiar'], .00003)
            self.assertEqual(medida['recall'], 1.0)
            self.assertEqual(medida['falso_positivo'], 0.0)

    def test_confere_todas_as_frases_e_os_rotulos_contra_o_manifesto(self):
        linhas = self.linhas()
        falas = [{k: l[k] for k in ('id', 'grupo', 'parte')} | l['alvo'] for l in linhas]
        manifesto = {'falas_sha256': hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}
        conferir_desenvolvimento(linhas, falas, manifesto)
        with self.assertRaisesRegex(ValueError, 'todo o desenvolvimento'):
            conferir_desenvolvimento(linhas[:-1], falas, manifesto)
        for campo, valor in [('grupo', 'outro'), ('alvo', dict.fromkeys(('clinica', 'risco', 'ambigua'), 7))]:
            modificadas = copy.deepcopy(linhas)
            modificadas[0][campo] = valor
            with self.assertRaisesRegex(ValueError, 'outro grupo ou rótulo'):
                conferir_desenvolvimento(modificadas, falas, manifesto)
        with self.assertRaisesRegex(ValueError, 'mudaram'):
            conferir_desenvolvimento(linhas, falas[:-1], manifesto)


if __name__ == '__main__':
    unittest.main()
