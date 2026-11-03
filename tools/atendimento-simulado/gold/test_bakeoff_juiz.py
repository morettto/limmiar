import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from bakeoff_juiz import ece, limiar, metricas, montar_pool, pares, pontuar, resumir

PMCIDS = [f'PMC{i}' for i in range(1, 6)]


def sessao(nome: str) -> tuple[list[dict], dict, dict[str, dict]]:
    passagens = {f'{p}:1:{k}': {'trecho_id': f'{p}:1:{k}', 'pmcid': p, 'pagina': 1, 'paragrafo': k,
                                'texto': f'{nome} {p} trecho {k}'} for p in PMCIDS for k in range(6)}
    contexto = {'sessao': nome, 'materiais': [{'pmcid': p, 'passagens': [passagens[f'{p}:1:{k}'] for k in range(6)]}
                                              for p in PMCIDS]}
    gold = [{'sessao': nome, 'id': f'{nome}-p{p}-{k}', 'tipo': 'positivo', 'subtipo': 'fenomeno',
             'frase': f'{nome} fala sobre {p} {k}', 'ancora': {'trecho_id': f'{p}:1:{k}', 'pmcid': p}}
            for p in PMCIDS for k in range(2)]
    gold += [{'sessao': nome, 'id': f'{nome}-n-{s}', 'tipo': 'negativo', 'subtipo': s, 'frase': f'{nome} {s}'}
             for s in ('conversa', 'figurado')]
    return gold, contexto, passagens


def juiz_falso(chamadas: list, ancoras: dict[str, str]):
    def carregar():
        def juiz(frase, textos):
            chamadas.append(frase)
            return [0.9 if t == ancoras.get(frase) else 0.1 for t in textos]
        return juiz, 7
    return carregar


def fala(sessao_: str, nome: str, tipo: str, subtipo: str, notas: list[float], ancora: int | None) -> list[dict]:
    return [{'sessao': sessao_, 'id': nome, 'tipo': tipo, 'subtipo': subtipo, 'trecho_id': str(i),
             'grupo': 'ancora' if i == ancora else 'fala_negativa' if ancora is None else 'outro_material',
             'rotulo': int(i == ancora), 'nota': n} for i, n in enumerate(notas)]


class PoolTest(unittest.TestCase):
    def test_pool_tem_ancoras_e_dois_extras_por_material_com_sorteio_fixo(self):
        gold, contexto, passagens = sessao('s1')
        pool = montar_pool(gold, contexto, passagens)
        ids = [t['trecho_id'] for t in pool]
        self.assertEqual(ids[:10], [r['ancora']['trecho_id'] for r in gold[:10]])
        self.assertEqual(len(set(ids)), 20)
        extras = pool[10:]
        self.assertTrue(all(t['paragrafo'] >= 2 for t in extras), 'extras never repeat an anchor')
        self.assertEqual(sorted(t['pmcid'] for t in extras), sorted(PMCIDS * 2))
        self.assertEqual(montar_pool(gold, contexto, passagens), pool, 'same seed, same pool')

    def test_so_o_par_positivo_ancora_tem_rotulo_e_negativos_tem_grupo(self):
        gold, contexto, passagens = sessao('s1')
        pool = montar_pool(gold, contexto, passagens)
        positivo = pares(gold[0], pool)
        self.assertEqual([p['trecho_id'] for p in positivo if p['rotulo']], ['PMC1:1:0'])
        grupos = [p['grupo'] for p in positivo]
        self.assertEqual((grupos.count('ancora'), grupos.count('mesmo_material'), grupos.count('outro_material')),
                         (1, 3, 16))
        negativo = pares(gold[-1], pool)
        self.assertEqual({(p['grupo'], p['rotulo']) for p in negativo}, {('fala_negativa', 0)})


class MetricasTest(unittest.TestCase):
    def test_limiar_maximiza_recall_com_precisao_e_respeita_empates(self):
        falas = [{'nota': .9, 'acerto': True}, {'nota': .8, 'acerto': True}, {'nota': .8, 'acerto': False},
                 {'nota': .5, 'acerto': True}]
        self.assertEqual(limiar(falas, .95), .9)
        self.assertEqual(limiar(falas, .6), .5)
        self.assertTrue(math.isinf(limiar([{'nota': .9, 'acerto': False}], .95)))

    def test_limiar_fora_da_sessao_e_metricas_de_produto(self):
        pares_ = (fala('A', 'A.p1', 'positivo', 'fenomeno', [.9, .4], 0) + fala('A', 'A.p2', 'positivo', 'fenomeno', [.1, .8], 0)
                  + fala('A', 'A.n', 'negativo', 'conversa', [.3, 0], None)
                  + fala('B', 'B.p1', 'positivo', 'fenomeno', [.7, .2], 0) + fala('B', 'B.p2', 'positivo', 'fenomeno', [.6, .1], 0)
                  + fala('B', 'B.n', 'negativo', 'logistica', [.85, 0], None)
                  + fala('C', 'C.p1', 'positivo', 'fenomeno', [.95, .3], 0) + fala('C', 'C.p2', 'positivo', 'fenomeno', [.4, .2], 0)
                  + fala('C', 'C.n', 'negativo', 'figurado', [.97, 0], None))
        m = metricas(pares_)
        self.assertEqual(m['limiar_por_sessao'], {'A': None, 'B': None, 'C': .9})
        self.assertEqual((m['precisao']['k'], m['precisao']['n']), (1, 2))
        self.assertEqual((m['recall']['k'], m['recall']['n']), (1, 6))
        self.assertEqual((m['cartao_falso']['k'], m['cartao_falso']['n']), (1, 3))
        self.assertEqual(m['cartao_falso_por_subtipo']['figurado']['k'], 1)
        self.assertEqual(m['cartao_falso_por_subtipo']['conversa']['k'], 0)

    def test_ece(self):
        self.assertEqual(ece(np.array([1., 1, 0, 0]), np.array([1, 0, 0, 0])), .25)
        self.assertEqual(ece(np.array([.05, .95]), np.array([0, 1])), .05)


class FimAFimTest(unittest.TestCase):
    def test_juiz_falso_perfeito_e_cache_reaproveitado(self):
        sessoes, ancoras = [], {}
        for nome in ('s1', 's2', 's3'):
            gold, contexto, passagens = sessao(nome)
            sessoes.append((gold, montar_pool(gold, contexto, passagens)))
            ancoras |= {r['frase']: passagens[r['ancora']['trecho_id']]['texto'] for r in gold if r['tipo'] == 'positivo'}
        chamadas: list = []
        with tempfile.TemporaryDirectory() as pasta:
            pontuados = pontuar('falso', juiz_falso(chamadas, ancoras), sessoes, Path(pasta))
            self.assertEqual((len(chamadas), len(pontuados)), (36, 36 * 20))
            self.assertEqual(len(pontuar('falso', juiz_falso(chamadas, ancoras), sessoes, Path(pasta))), 36 * 20)
            self.assertEqual(len(chamadas), 36, 'rerun reads the cache instead of judging again')
            m = metricas(pontuados)
            self.assertEqual(m['auroc'], 1.0)
            self.assertEqual(m['auroc_por_grupo']['mesmo_material'], 1.0)
            self.assertEqual(m['recall']['taxa'], 1.0)
            self.assertEqual(m['cartao_falso']['k'], 0)
            self.assertEqual(m['limiar_por_sessao'], {'s1': .9, 's2': .9, 's3': .9})
            self.assertLess(m['ece_isotonico'], m['ece_bruto'])
            self.assertEqual(resumir(sessoes, Path(pasta)), {}, 'only registered judges are summarised')


if __name__ == '__main__':
    unittest.main()
