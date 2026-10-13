import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import embedder, juiz, treinado

A = "A primeira frase descreve uma experiência de sofrimento."
B = "A segunda frase descreve uma outra experiência diferente."
C = "O terceiro trecho contém uma experiência independente e citável."


class CitacoesEmLote(unittest.TestCase):
    def test_citacao_isolada_tambem_tem_de_sustentar_a_frase_atual(self):
        texto = A + ' ' + B
        with patch.object(treinado, 'julgar', return_value=[.3, .98]) as julgar:
            resultado = juiz.citacoes_qualificadas('A minha experiência atual.', ['Outro relato anterior.'], [texto], [.99], .95)
        self.assertEqual(resultado, [(B, .98)])
        julgar.assert_called_once_with('A minha experiência atual.', ['Outro relato anterior.'], [A, B])
        self.assertTrue(juiz.citacao_confere(resultado[0][0], texto))

    def test_nao_retira_contexto_necessario_do_paragrafo_aprovado(self):
        texto = A + ' ' + B
        with patch.object(treinado, 'julgar', return_value=[.2, .1]):
            self.assertEqual(juiz.citacoes_qualificadas('Isso acontece comigo.', ['Referência anterior.'], [texto], [.99], .95), [(texto, .99)])

    def test_recusa_citacao_sem_seis_palavras_ou_resposta_incompleta_do_juiz(self):
        self.assertEqual(juiz.citacoes_qualificadas('fala', [], [], [], .95), [])
        self.assertEqual(juiz.citacoes_qualificadas('fala', [], ['Texto curto'], [.99], .95), [('', 0.0)])
        with patch.object(treinado, 'julgar', return_value=[.99]):
            with self.assertRaisesRegex(ValueError, 'todas as citações'):
                juiz.citacoes_qualificadas('fala', [], [A + ' ' + B], [.99], .95)

    def setUp(self):
        juiz._CITACOES.clear()

    def tearDown(self):
        juiz._CITACOES.clear()

    def test_agrupa_fontes_sem_recodificar_fala_e_preserva_ordem_e_citacao_literal(self):
        textos = [A + " " + B, C, A + " " + B]
        with patch.object(embedder, "codificar_documentos", return_value=np.array([[1, 0], [0, 1], [1, 0]])) as documentos, \
                patch.object(embedder, "codificar_consultas", return_value=np.array([[0, 1]])) as consultas:
            self.assertEqual(juiz.frases_mais_proximas("fala", textos), [B, C, B])
            documentos.assert_called_once_with([A, B, C])
            consultas.assert_called_once_with(["fala"])

    def test_reutiliza_so_fontes_e_recalcula_a_fala_atual_sem_guardar_texto_do_paciente(self):
        with patch.object(embedder, "codificar_documentos", return_value=np.array([[1, 0], [0, 1]])) as documentos, \
                patch.object(embedder, "codificar_consultas", side_effect=[np.array([[1, 0]]), np.array([[0, 1]])]) as consultas:
            self.assertEqual(juiz.frase_mais_proxima("primeiro relato", A + " " + B), A)
            self.assertEqual(juiz.frase_mais_proxima("contexto corrigido", A + " " + B), B)
            self.assertEqual(documentos.call_count, 1)
            self.assertEqual(consultas.call_count, 2)
            self.assertEqual(list(juiz._CITACOES), [A + " " + B])

    def test_vetor_da_consulta_e_reutilizado_e_cache_tem_limite(self):
        with patch.object(juiz, "MAX_PASSAGENS_CITACOES", 1), \
                patch.object(embedder, "codificar_documentos", return_value=np.array([[1, 0], [0, 1]])), \
                patch.object(embedder, "codificar_consultas") as consultas:
            self.assertEqual(juiz.frases_mais_proximas("fala", [A, B], np.array([1, 0])), [A, B])
            consultas.assert_not_called()
            self.assertEqual(list(juiz._CITACOES), [B])

    def test_fontes_vazias_curtas_e_metadados_nao_exigem_inferencia(self):
        with patch.object(embedder, "codificar_documentos") as documentos, \
                patch.object(embedder, "codificar_consultas") as consultas:
            self.assertEqual(juiz.frases_mais_proximas("fala", []), [])
            self.assertEqual(juiz.frase_mais_proxima("fala", "texto curto"), "texto curto")
            documentos.assert_not_called()
            consultas.assert_not_called()
        self.assertEqual(juiz._frases_citaveis("Referência bibliográfica https://example.org com mais de seis palavras. " + A), (A,))


if __name__ == "__main__":
    unittest.main()
