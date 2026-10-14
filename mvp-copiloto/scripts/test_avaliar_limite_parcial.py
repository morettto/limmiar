import hashlib
import unittest
from pathlib import Path
from unittest.mock import patch

from avaliar_limite_parcial import conferir_versao, limite_otimista


def linha(p, alvo):
    return {'notas': {'alvo': p}, 'alvo': {'alvo': alvo}}


class LimiteParcial(unittest.TestCase):
    def test_conferir_versao_recusa_mudanca_em_cada_artefato_incluindo_formulacao_e_candidato(self):
        conteudo = b'artefato congelado de teste'
        sha = hashlib.sha256(conteudo).hexdigest()
        versao = {'config': {'rotulos_duros': True, 'formato': 'qwen-frase-v2', 'semantica_v2': True,
                             'candidato_sha256': sha},
                  'script_sha256': sha, 'formato_sha256': sha, 'revisao_fontes_sha256': sha}
        with patch.object(Path, 'read_bytes', return_value=conteudo) as ler:
            conferir_versao(versao, 'qwen-frase-r3')
            self.assertEqual(ler.call_count, 4)
            for campo in ('script_sha256', 'formato_sha256', 'revisao_fontes_sha256'):
                with self.subTest(campo=campo), self.assertRaisesRegex(ValueError, campo):
                    conferir_versao({**versao, campo: 'hash diferente'}, 'qwen-frase-r3')
            with self.assertRaisesRegex(ValueError, 'Candidato'):
                conferir_versao({**versao, 'config': {**versao['config'], 'candidato_sha256': 'hash diferente'}}, 'qwen-frase-r3')
            with self.assertRaisesRegex(ValueError, 'rótulos revisados'):
                conferir_versao({**versao, 'config': {**versao['config'], 'formato': 'qwen-frase-v1'}}, 'qwen-frase-r3')

    def test_inclui_corte_imediatamente_acima_do_erro_e_assume_restantes_perfeitos(self):
        resultado = limite_otimista([linha(.9, 0), linha(.95, 1)], 100)
        self.assertEqual(resultado['validos_observados'], 1)
        self.assertEqual(resultado['invalidos_observados'], 0)
        self.assertGreater(resultado['wilson_maximo'], .95)

    def test_nao_inventa_positivos_ja_reprovados_nem_remove_erro_com_score_um(self):
        resultado = limite_otimista([linha(.99, 0), linha(.98, 1)], 36)
        self.assertLess(resultado['wilson_maximo'], .95)
        resultado = limite_otimista([linha(1., 0)], 10)
        self.assertEqual(resultado['invalidos_observados'], 1)
        with self.assertRaises(ValueError):
            limite_otimista([linha(float('nan'), 1)], 10)
        with self.assertRaises(ValueError):
            limite_otimista([linha(.5, True)], 10)
        with self.assertRaises(ValueError):
            limite_otimista([], -1)


if __name__ == '__main__':
    unittest.main()
