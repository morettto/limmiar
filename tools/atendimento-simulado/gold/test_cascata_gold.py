import json
import math
import tempfile
import unittest
from pathlib import Path

import cascata
from bakeoff_juiz import montar_pool
from test_bakeoff_juiz import sessao


def notas(sessoes, nota_aluno, nota_professor) -> tuple[dict, dict]:
    aluno, professor = {}, {}
    for gold, pool in sessoes:
        for fala in gold:
            chave = (fala['sessao'], fala['id'])
            aluno[chave] = {t['trecho_id']: nota_aluno(fala, t) for t in pool}
            professor[chave] = {t['trecho_id']: nota_professor(fala, t) for t in pool}
    return aluno, professor


def ancora(fala, trecho) -> bool:
    return fala['tipo'] == 'positivo' and trecho['trecho_id'] == fala['ancora']['trecho_id']


class CascataNoGabarito(unittest.TestCase):
    def setUp(self):
        self.sessoes = []
        for nome in ('s1', 's2', 's3', 's4'):
            gold, contexto, passagens = sessao(nome)
            self.sessoes.append((gold, montar_pool(gold, contexto, passagens)))

    def test_professor_que_separa_a_ancora_mostra_todo_positivo_e_nenhum_negativo(self):
        aluno, professor = notas(self.sessoes, lambda f, t: 0.9 if ancora(f, t) else 0.5,
                                 lambda f, t: 0.95 if ancora(f, t) else 0.1)
        falas = cascata.falas(self.sessoes, aluno, professor)
        self.assertTrue(all(f['ancora_no_topo'] for f in falas if f['tipo'] == 'positivo'))
        limiar = cascata.bakeoff.limiar(falas, cascata.ALVO_PRECISAO)
        self.assertAlmostEqual(limiar, math.log(0.95 / 0.05) - math.log(0.1 / 0.9))
        medida = cascata.medir(falas, limiar)
        self.assertEqual((medida['cobertura']['k'], medida['cartao_falso']['k']), (40, 0))
        estimada = cascata.estimar(falas, [{'s1', 's2'}, {'s3', 's4'}])
        self.assertEqual((estimada['precisao']['k'], estimada['precisao']['n']), (40, 40))

    def test_professor_que_nao_diz_sim_nunca_mostra(self):
        aluno, professor = notas(self.sessoes, lambda f, t: 0.5, lambda f, t: 0.4 if ancora(f, t) else 0.01)
        falas = cascata.falas(self.sessoes, aluno, professor)
        self.assertTrue(all(f['nota'] == -math.inf for f in falas))

    def test_registrar_troca_so_a_linha_da_versao(self):
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = Path(pasta) / 'registro.jsonl'
            arquivo.write_text(json.dumps({'versao': 'v2', 'promovida': True}) + '\n', encoding='utf-8')
            cascata.registrar({'versao': 'cascata-v9', 'limiares': {'margem': 1.0}}, arquivo)
            cascata.registrar({'versao': 'cascata-v9', 'limiares': {'margem': 2.0}}, arquivo)
            linhas = [json.loads(linha) for linha in arquivo.read_text(encoding='utf-8').splitlines()]
        self.assertEqual([(r['versao'], r.get('limiares')) for r in linhas],
                         [('v2', None), ('cascata-v9', {'margem': 2.0})])


if __name__ == '__main__':
    unittest.main()
