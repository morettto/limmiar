import sys
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from copiloto import frase, treinado


class FraseAtual(unittest.TestCase):
    def test_foco_atual_conserva_negacao_sem_substituir_pela_fala_anterior(self):
        entrada = frase.formato_qwen('Hoje eu não estou com medo.', ['Ontem fiquei com medo.'], 'A ansiedade se caracteriza por medo persistente.')
        self.assertLess(entrada.index('Hoje eu não estou com medo.'), entrada.index('Ontem fiquei com medo.'))
        self.assertIn('Previous sentences only clarify references', entrada)
        self.assertIn('Respect negation, reported speech', entrada)

    def test_apoio_contextual_chega_inteiro_e_documento_nao_e_truncado(self):
        contexto = [str(i) + 'A' * 1800 for i in range(5)]
        trecho = 'Documento completo ' + 'B' * 6000
        entrada = frase.formato_qwen('Aquilo ainda acontece comigo.', contexto, trecho)
        for anterior in contexto:
            self.assertIn(anterior, entrada)
        self.assertIn(trecho, entrada)
        self.assertTrue(entrada.endswith('</think>\n\n'))

    def test_frase_sem_historico_explicita_ausencia_de_apoio(self):
        self.assertEqual(frase.consulta('Sinto medo.', []), 'CURRENT patient sentence:\nSinto medo.\n\nPrevious sentences, only to resolve references:\n(none)')

    def test_formato_do_checkpoint_define_entrada_e_cabeca_de_triagem(self):
        with tempfile.TemporaryDirectory() as pasta, patch.object(treinado, 'MODELOS', Path(pasta)), \
                patch.object(treinado, 'NOME_JUIZ', 'juiz-frase'):
            checkpoint = Path(pasta) / 'juiz-frase/torch'
            checkpoint.mkdir(parents=True)
            (checkpoint / 'formato.txt').write_text('qwen-frase-v2', encoding='utf-8')
            self.assertEqual(treinado.consulta_para_modelo('Hoje não.', ['Ontem eu tinha medo.']),
                             frase.consulta('Hoje não.', ['Ontem eu tinha medo.']))
            self.assertEqual(treinado.arquivo_triagem(), Path(pasta) / 'triagem-frase-rbf/rbf.npz')
            (checkpoint / 'formato.txt').write_text('formato-desconhecido', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'desconhecida'):
                treinado.consulta_para_modelo('Hoje não.', [])

    def test_treino_e_inferencia_usam_mesma_instrucao_documento_e_frase(self):
        import treinar
        from unittest.mock import Mock
        import torch

        tok = Mock(return_value={'input_ids': torch.ones((1, 5))})
        q = frase.consulta('Eu me sinto assim.', ['Meu medo continua.'])
        treinar._codificar(tok, [{'q': q, 'trecho': 'Documento inteiro'}], True, 100, 'qwen-frase-v2')
        self.assertEqual(tok.call_args.args[0], [frase.formato_qwen('Eu me sinto assim.', ['Meu medo continua.'], 'Documento inteiro')])
        self.assertIs(tok.call_args.kwargs['truncation'], False)

    def test_peso_de_contraste_aplica_a_fontes_validas_e_invalidas_sem_depender_do_alvo(self):
        import treinar
        import torch

        exemplos = [{'alvo': 1., 'contraste_fonte': True}, {'alvo': 0., 'contraste_fonte': True},
                    {'alvo': 1., 'contraste_fonte': False}, {'alvo': 0.}]
        self.assertEqual(treinar._pesos_contrastes(exemplos, {'peso_contraste_fonte': 8.}, 'cpu').tolist(),
                         [[8.], [8.], [1.], [1.]])
        self.assertTrue(torch.equal(treinar._pesos_contrastes(exemplos, {}, 'cpu'), torch.ones(4, 1)))

    def test_revisao_por_posicao_recusa_conjunto_alterado_antes_de_escrever_rotulos(self):
        import revisar_fontes_semantica_dev as revisao

        with tempfile.TemporaryDirectory() as pasta, patch.object(revisao, 'RAIZ', Path(pasta)):
            fonte = Path(pasta) / 'resultados/fontes-contraste-dev-revisao-v2.json'
            fonte.parent.mkdir()
            fonte.write_text('[]', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'conjunto revisado mudou'):
                revisao.main()
            self.assertFalse((Path(pasta) / 'data/treino/fontes-dev-semantica-v2.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
