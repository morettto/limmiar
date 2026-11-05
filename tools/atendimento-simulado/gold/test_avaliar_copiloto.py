import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

import avaliar_copiloto
from avaliar_copiloto import CHAMADAS_JUIZ, avaliar, ler, preparar, resumo
from candidatos import arquivo as arquivo_candidatos
from passagens import GOLD, acervo_profissional, artigos
from pontuar import pontuar_fala

SESSAO = 'sessao-006'
CAMPOS_CARTAO = {'trecho_id', 'pmcid', 'pagina', 'probabilidade', 'nivel', 'citacao_literal'}


def decisao(cartoes: list, pmcid: str):
    candidatos = [{'trecho_id': f'{pmcid}:1:{i}', 'generico': 0.1} for i in range(8)]
    for registro in candidatos[:6]:
        registro['juiz'] = 0.9
    return SimpleNamespace(cartoes=cartoes, alerta_risco=True, clarificar=False, completo=True, candidatos=candidatos,
                           motivo_silencio=None if cartoes else 'sem fonte', tempos_ms={'juiz': 1.0})


class AcervoFalso:
    def __init__(self):
        self.chamadas, self.aberturas = [], []

    @contextmanager
    def abrir(self, sessao_id: str, pmcids: list[str]):
        self.aberturas.append((sessao_id, pmcids))
        yield self.decidir

    def decidir(self, frase: str, contexto: list[str]):
        self.chamadas.append((frase, list(contexto)))
        CHAMADAS_JUIZ.extend([None, None])
        pmcid = self.aberturas[-1][1][0]
        cartao = SimpleNamespace(trecho_id=f'{pmcid}:1:1', arquivo=pmcid, pagina=1, probabilidade=0.8, nivel='possivel',
                                 citacao_literal='texto literal', texto='nao vai para o resultado')
        return decisao([cartao], pmcid)


def esperado(sessao_id: str) -> list[tuple[str, list[str]]]:
    """Merge by (turn, after-patient, gold-file order): an independent restatement of where each line lands."""
    contexto = json.loads(arquivo_candidatos(sessao_id).read_text(encoding='utf-8'))
    gold = ler(GOLD / 'sessoes' / f'{sessao_id}.jsonl')
    eventos = sorted([(t['index'], 0, t['text'], None) for t in contexto['turnos'] if t['role'] == 'Paciente']
                     + [(row['inserir_apos_turno'], 1 + n, row['frase'], row['id']) for n, row in enumerate(gold)])
    return [(e[3], [a[2] for a in eventos[:i]][-5:]) for i, e in enumerate(eventos) if e[3]]


LOCAL = unittest.skipUnless((GOLD / 'sessoes' / f'{SESSAO}.jsonl').exists(), 'gabarito local ausente')


@LOCAL
class LoopTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.saida = Path(self.dir.name) / 'run.jsonl'
        self.acervo = AcervoFalso()

    def tearDown(self):
        self.dir.cleanup()

    def test_ordem_contexto_e_formato(self):
        self.assertEqual(avaliar([SESSAO], self.saida, self.acervo.abrir), 16)
        linhas = ler(self.saida)
        self.assertEqual([(r['id'], r['contexto']) for r in linhas], esperado(SESSAO))
        materiais = [m['pmcid'] for m in json.loads(arquivo_candidatos(SESSAO).read_text(encoding='utf-8'))['materiais']]
        self.assertEqual(self.acervo.aberturas, [(SESSAO, materiais)])
        terapeuta = {t['text'] for t in json.loads(arquivo_candidatos(SESSAO).read_text(encoding='utf-8'))['turnos']
                     if t['role'] != 'Paciente'}
        self.assertFalse(terapeuta & {c for r in linhas for c in r['contexto']}, 'only patient statements reach contexto')
        gold = {row['id']: row for row in ler(GOLD / 'sessoes' / f'{SESSAO}.jsonl')}
        for row in linhas:
            self.assertEqual(set(row['cartoes'][0]), CAMPOS_CARTAO)
            self.assertEqual(row['chamadas_juiz'], 2)
            self.assertIs(row['alerta_risco'], True)
            self.assertEqual((len(row['candidatos']), len(row['julgados'])), (8, 6))
            pontuar_fala(gold[row['id']], row, set(materiais))

    def test_retoma_sem_repetir(self):
        self.assertEqual(avaliar([SESSAO], self.saida, self.acervo.abrir, limite=3), 3)
        self.assertEqual(avaliar([SESSAO], self.saida, self.acervo.abrir), 13)
        self.assertEqual(avaliar([SESSAO], self.saida, self.acervo.abrir), 0)
        self.assertEqual(len(self.acervo.aberturas), 2, 'a finished session never prepares its materials again')
        ids = [r['id'] for r in ler(self.saida)]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(self.acervo.chamadas), 16)

    def test_resumo_pontua_e_mede_latencia(self):
        avaliar([SESSAO], self.saida, self.acervo.abrir)
        final, erros = resumo(self.saida)
        self.assertEqual(erros, [])
        self.assertEqual(json.loads(self.saida.with_suffix('.resumo.json').read_text(encoding='utf-8')), final)
        self.assertEqual(final['falas'], 16)
        self.assertEqual(final['custo']['todas']['chamadas_llm_por_fala'], 2)
        self.assertLessEqual(final['custo']['todas']['latencia_ms']['p50'], final['custo']['todas']['latencia_ms']['p95'])
        busca = final['busca']
        self.assertEqual(busca['portao_abriu']['k'], busca['portao_abriu']['n'])
        self.assertLessEqual(busca['ancora_julgada']['k'], busca['ancora_na_busca_40']['k'])


@LOCAL
class CacheTest(unittest.TestCase):
    def setUp(self):
        self.pmcid = json.loads(arquivo_candidatos(SESSAO).read_text(encoding='utf-8'))['materiais'][0]['pmcid']
        self.codificados, self.julgados = [], []
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        self.addCleanup(acervo_profissional.ACERVO.remover, 'eval-teste', self.pmcid)
        for alvo in (patch.object(avaliar_copiloto, 'CACHE', Path(pasta.name)),
                     patch.object(acervo_profissional.embedder, 'codificar_documentos', side_effect=self.codificar),
                     patch.object(acervo_profissional.juiz_pequeno, 'generico', side_effect=self.generico)):
            alvo.start()
            self.addCleanup(alvo.stop)

    def codificar(self, textos, *_, **__):
        self.codificados.extend(textos)
        return np.array([[len(t), sum(map(ord, t)) % 97] for t in textos], dtype=np.float32)

    def generico(self, textos):
        self.julgados.extend(textos)
        return [len(t) % 7 / 7 for t in textos]

    def preparar(self):
        return preparar('eval-teste', self.pmcid, artigos()[self.pmcid])

    def test_segunda_preparacao_nao_codifica_nem_julga(self):
        primeiro = self.preparar()
        quantos = (len(self.codificados), len(self.julgados))
        segundo = self.preparar()
        self.assertGreater(quantos[0], 0)
        self.assertEqual((len(self.codificados), len(self.julgados)), quantos, 'cache hit skips encoder and judge')
        self.assertEqual(primeiro.blocks, segundo.blocks)
        self.assertEqual(primeiro.embeddings.tolist(), segundo.embeddings.tolist())
        self.assertEqual(primeiro.generico.tolist(), segundo.generico.tolist())

    def test_cache_sem_generico_reaproveita_os_vetores_e_ganha_o_generico(self):
        primeiro = self.preparar()
        cache, = avaliar_copiloto.CACHE.glob('*.npz')
        with np.load(cache) as salvo:
            antigo = {chave: salvo[chave] for chave in ('textos', 'vetores', 'modelo')}
        np.savez(cache, **antigo)
        codificados = len(self.codificados)
        segundo = self.preparar()
        self.assertEqual(len(self.codificados), codificados, 'old vectors are reused')
        self.assertEqual(len(self.julgados), 2 * len({b.texto for b in primeiro.blocks}), 'generico is computed once more')
        self.assertEqual(primeiro.generico.tolist(), segundo.generico.tolist())
        julgados = len(self.julgados)
        self.preparar()
        self.assertEqual(len(self.julgados), julgados, 'the upgraded cache now carries generico')


if __name__ == '__main__':
    unittest.main()
