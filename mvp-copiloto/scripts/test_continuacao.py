import base64
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import continuacao


class Continuacao(unittest.TestCase):
    def setUp(self):
        self.vinculo = {"consulta": {"frase": "Tenho pesadelos.", "contexto": ["Desde o assalto."],
                                    "falante": "paciente", "idioma": "pt-BR", "obras_ids": ["livro"]},
                        "versao": {"indice": "hash"}, "limiares": {"geral": .95}}

    def test_retoma_posicao_sem_incluir_fala_contexto_ou_identidade_no_token(self):
        token = continuacao.emitir(16, self.vinculo)
        self.assertEqual(len(token), 48)
        self.assertEqual(continuacao.abrir(token, copy.deepcopy(self.vinculo)), 16)
        dados = base64.urlsafe_b64decode(token)
        self.assertEqual(len(dados), 36)
        self.assertNotIn(b"pesadelos", dados)

    def test_alteracao_da_consulta_obra_versao_limiar_ou_reinicio_invalida_token(self):
        token = continuacao.emitir(8, self.vinculo)
        for campo, valor in (("frase", "Era um relato da minha irmã."), ("contexto", []),
                             ("falante", "terapeuta"), ("idioma", "en-US"), ("obras_ids", [])):
            outro = copy.deepcopy(self.vinculo)
            outro["consulta"][campo] = valor
            with self.assertRaisesRegex(ValueError, "Continuação inválida"):
                continuacao.abrir(token, outro)
        for campo in ("versao", "limiares"):
            outro = {**self.vinculo, campo: {"mudou": True}}
            with self.assertRaises(ValueError):
                continuacao.abrir(token, outro)
        with patch.object(continuacao, "_SEGREDO", b"outra inicializacao"):
            with self.assertRaises(ValueError):
                continuacao.abrir(token, self.vinculo)

    def test_recusa_posicao_assinatura_e_base64_invalidos(self):
        for posicao in (0, -1, True, 2**32, "8"):
            with self.assertRaisesRegex(ValueError, "Posição"):
                continuacao.emitir(posicao, self.vinculo)
        token = continuacao.emitir(8, self.vinculo)
        adulterado = bytearray(base64.urlsafe_b64decode(token))
        adulterado[3] = 16
        for falso in (None, "", token[:-1], "!" * 48, "á" * 48,
                      base64.urlsafe_b64encode(adulterado).decode(), base64.urlsafe_b64encode(b"\0" * 36).decode()):
            with self.assertRaisesRegex(ValueError, "Continuação inválida"):
                continuacao.abrir(falso, self.vinculo)


if __name__ == "__main__":
    unittest.main()
