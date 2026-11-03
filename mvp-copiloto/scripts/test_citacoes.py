import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import juiz

A = "A primeira frase descreve uma experiência de sofrimento."
B = "A segunda frase descreve uma outra experiência diferente."


class OpcoesDeCitacao(unittest.TestCase):
    def test_frases_do_trecho_e_o_trecho_curto_inteiro_sao_opcoes_literais(self):
        texto = A + " " + B
        self.assertEqual(juiz.opcoes_de_citacao(texto), (A, B, texto))
        self.assertTrue(all(juiz.citacao_confere(c, texto) for c in juiz.opcoes_de_citacao(texto)))

    def test_recusa_citacao_sem_seis_palavras(self):
        self.assertEqual(juiz.opcoes_de_citacao("Texto curto"), ())

    def test_nao_mostra_paragrafo_como_citacao_quando_excede_30_palavras(self):
        self.assertEqual(juiz.opcoes_de_citacao(" ".join(["relato"] * 40) + "."), ())

    def test_nao_apresenta_item_de_referencia_bibliografica_como_citacao(self):
        self.assertEqual(juiz.opcoes_de_citacao("(2013).PTSS bij de politie*een beter beeld;"), ())

    def test_frases_com_metadados_bibliograficos_nao_sao_citaveis(self):
        self.assertEqual(juiz._frases_citaveis("Referência bibliográfica https://example.org com mais de seis palavras. " + A), (A,))


if __name__ == "__main__":
    unittest.main()
