import unittest

from copiloto.trecho import prosa

PROSA = ("A ansiedade antecipatória aparece quando a pessoa interpreta sensações corporais inofensivas como sinais de uma doença grave "
         "e passa a evitar situações, repetindo exames e buscando reasseguramento constante com a família e os médicos.")


class Trecho(unittest.TestCase):
    def test_prosa_corrida_passa(self):
        self.assertTrue(prosa(PROSA))

    def test_cabecalho_palavras_chave_ocr_e_bibliografia_caem(self):
        self.assertFalse(prosa("Keywords: Depression symptoms, Diagnostic and Statistical Manual, Heterogeneity, Major depressive disorder, Nosology"))
        self.assertFalse(prosa("curto demais"))
        self.assertFalse(prosa(" ".join("i n d e p r e s s i o n a n d a n x i e t y c a n b e s e e n a s a c o m o r b i d".split()) * 2))
        refs = " ".join(f"Silva, A. B. & Costa, C. D. ({2000 + i}). Título do artigo. Revista, {i}, 1-10." for i in range(8))
        self.assertFalse(prosa(refs))

    def test_prosa_com_citacoes_e_cabecalho_de_pagina_continua(self):
        self.assertTrue(prosa("Rev. Latinoam. Psicopat. Fund., São Paulo, v. 14, n. 2, 2011 " + PROSA + " (Stroebe & Schut, 1999)."))


if __name__ == "__main__":
    unittest.main()
