import copy
import hashlib
import unittest

from calibrar_contexto import calibrar, wilson


class CalibracaoContextual(unittest.TestCase):
    def setUp(self):
        self.grupos = {f"caso-{i}": f"caso-{i}" for i in range(100)}
        self.linhas = [{"id": id_, "arquivo": "fonte.pdf", "pagina": 1, "paragrafo": 1,
                        "parte": int(hashlib.sha256(grupo.encode()).hexdigest(), 16) % 3,
                        "notas": {"alvo": .98}, "alvo": {"alvo": 1}, "contraste_fonte": True}
                       for id_, grupo in self.grupos.items()]
        self.linhas += [{**l, "pagina": 2, "notas": {"alvo": .01}, "alvo": {"alvo": 0}} for l in self.linhas]

    def test_escolhe_limiar_so_de_development_oof_e_nao_declara_qualificacao_clinica(self):
        resultado = calibrar(self.linhas, self.grupos)
        self.assertTrue(resultado["calibracao_aprovada"])
        self.assertFalse(resultado["validacao_clinica"])
        self.assertEqual(resultado["selecionado"]["recall_pares"], 1)
        self.assertGreaterEqual(resultado["selecionado"]["precisao_wilson_inferior"], .95)
        self.assertEqual(wilson(0, 0), 0)
        self.assertFalse(calibrar(self.linhas[:10], self.grupos)["calibracao_aprovada"])

    def test_media_boas_com_falas_faceis_nao_aprova_fontes_incorretas_na_mesma_fala(self):
        erradas = copy.deepcopy(self.linhas)
        for l in erradas:
            l["notas"]["alvo"] = .98
        faceis = [{**l, "pagina": pg, "contraste_fonte": False} for l in self.linhas[:100] for pg in range(10, 50)]
        resultado = calibrar(faceis + erradas, self.grupos)
        self.assertGreater(resultado["curva"][0]["precisao_wilson_inferior"], .95)
        self.assertEqual(resultado["contrastes_fontes"]["precisao"], .5)
        self.assertFalse(resultado["calibracao_aprovada"])
        self.assertFalse(calibrar([{**l, "contraste_fonte": False} for l in self.linhas], self.grupos)["calibracao_aprovada"])

    def test_recusa_duplicata_teste_particao_errada_e_predicao_incompleta(self):
        with self.assertRaisesRegex(ValueError, "duplicada"):
            calibrar(self.linhas + [self.linhas[0]], self.grupos)
        for id_ in ("teste-positivo-1", "final100-1"):
            erradas = copy.deepcopy(self.linhas)
            erradas[0]["id"] = id_
            with self.assertRaisesRegex(ValueError, "fora do desenvolvimento"):
                calibrar(erradas, self.grupos)
        for parte in (True, False, "1", 3, .0):
            erradas = copy.deepcopy(self.linhas)
            erradas[0]["parte"] = parte
            with self.assertRaises(ValueError):
                calibrar(erradas, self.grupos)
        with self.assertRaisesRegex(ValueError, "Faltam partições"):
            calibrar([l for l in self.linhas if l["parte"] != 2], self.grupos)

    def test_nao_calibra_probabilidades_invalidas_ou_rotulos_sem_adjudicacao(self):
        for prob in (True, None, -.1, 1.1, float("nan"), float("inf")):
            erradas = copy.deepcopy(self.linhas)
            erradas[0]["notas"]["alvo"] = prob
            with self.assertRaisesRegex(ValueError, "Probabilidade"):
                calibrar(erradas, self.grupos)
        for alvo in (True, None, .5, float("nan"), "0"):
            erradas = copy.deepcopy(self.linhas)
            erradas[0]["alvo"]["alvo"] = alvo
            with self.assertRaisesRegex(ValueError, "adjudicação binária"):
                calibrar(erradas, self.grupos)
        for marca in (None, 0, "true"):
            erradas = copy.deepcopy(self.linhas)
            erradas[0]["contraste_fonte"] = marca
            with self.assertRaisesRegex(ValueError, "contraste de fonte"):
                calibrar(erradas, self.grupos)


if __name__ == "__main__":
    unittest.main()
