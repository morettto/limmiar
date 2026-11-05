"""O juiz pequeno com um tokenizador minúsculo de verdade e a sessão ONNX trocada na fronteira: pares, ordem, lotes,
sigmoide e corte. Nesta máquina `import onnxruntime` custa 80 s (platform.system() espera o WMI), por isso o duplo."""
import math
import sys
import tempfile
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from tokenizers import Tokenizer, models, pre_tokenizers, processors

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import juiz_pequeno

FALA = "eu evito a rua do acidente"
ESCALA, DESLOCAMENTO = 0.1, 3.0


def tokenizador(textos: list[str]) -> Tokenizer:
    vocabulario = {"[PAD]": 0, "[UNK]": 1, "[CLS]": 2, "[SEP]": 3}
    for palavra in sorted({p for texto in textos for p, _ in pre_tokenizers.Whitespace().pre_tokenize_str(texto)}):
        vocabulario[palavra] = len(vocabulario)
    tok = Tokenizer(models.WordLevel(vocabulario, unk_token="[UNK]"))
    tok.pre_tokenizer = pre_tokenizers.Whitespace()
    tok.post_processor = processors.TemplateProcessing(single="[CLS] $A [SEP]", pair="[CLS] $A [SEP] $B [SEP]",
                                                       special_tokens=[("[CLS]", 2), ("[SEP]", 3)])
    return tok


class Sessao:
    """logit = ESCALA * id do último token antes do [SEP] final - DESLOCAMENTO, um por linha do lote."""
    criadas: list["Sessao"] = []

    def __init__(self, caminho, opcoes, providers):
        self.caminho, self.opcoes, self.providers, self.lotes = caminho, opcoes, providers, []
        Sessao.criadas.append(self)

    def run(self, saidas, entradas, execucao):
        self.lotes.append(entradas)
        ids, mascara = entradas["input_ids"], entradas["attention_mask"]
        ultimo = ids[np.arange(len(ids)), mascara.sum(axis=1) - 2]
        return [(ESCALA * ultimo - DESLOCAMENTO).astype(np.float32)[:, None]]


ORT = types.SimpleNamespace(SessionOptions=types.SimpleNamespace, RunOptions=Mock, InferenceSession=Sessao)


class JuizPequeno(unittest.TestCase):
    def setUp(self):
        self.trechos = [" ".join([f"p{k}" for k in range(n)] + [f"fim{i}"])
                        for i, n in enumerate([5, 1, 9, 3, 12, 2, 7, 4, 10, 6, 8])]
        self.longo = " ".join(f"p{k}" for k in range(400))
        self.tok = tokenizador([FALA, self.longo, *self.trechos, *juiz_pequeno.PERGUNTAS.values()])
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        self.raiz = Path(pasta.name)
        self.tok.save(str(self.raiz / "tokenizer.json"))
        Sessao.criadas = []
        for alvo in (patch.object(juiz_pequeno, "PASTA", self.raiz), patch.object(juiz_pequeno, "_CARREGADO", []),
                     patch.dict(sys.modules, {"onnxruntime": ORT})):
            alvo.start()
            self.addCleanup(alvo.stop)

    def ids(self, texto: str) -> list[int]:
        return self.tok.encode(texto, add_special_tokens=False).ids

    def linhas(self) -> list[list[int]]:
        return [[int(t) for t, m in zip(ids, mascara) if m]
                for lote in Sessao.criadas[0].lotes for ids, mascara in zip(lote["input_ids"], lote["attention_mask"])]

    def test_notas_voltam_na_ordem_da_entrada_pela_sigmoide_em_lotes_de_ate_oito_por_tamanho(self):
        notas = juiz_pequeno.principal(FALA, self.trechos)
        ultimos = [self.tok.token_to_id(f"fim{i}") for i in range(len(self.trechos))]
        esperado = [1 / (1 + math.exp(-(ESCALA * u - DESLOCAMENTO))) for u in ultimos]
        for nota, alvo in zip(notas, esperado, strict=True):
            self.assertAlmostEqual(nota, alvo, places=6)
        lotes = Sessao.criadas[0].lotes
        self.assertEqual([len(lote["input_ids"]) for lote in lotes], [8, 3])
        larguras = [len(ids) for ids in self.linhas()]
        self.assertEqual(larguras, sorted(larguras), "lotes montados do par mais curto ao mais longo")
        for lote in lotes:
            self.assertEqual(lote["input_ids"].shape[1], int(lote["attention_mask"].sum(axis=1).max()), "sem padding a mais")

    def test_cada_pergunta_entra_no_lado_certo_do_par(self):
        cls, sep = self.tok.token_to_id("[CLS]"), self.tok.token_to_id("[SEP]")
        juiz_pequeno.vivencia(FALA)
        juiz_pequeno.risco(FALA)
        juiz_pequeno.generico(["fim0"])
        perguntas = juiz_pequeno.PERGUNTAS
        self.assertEqual(self.linhas(), [
            [cls, *self.ids(FALA), sep, *self.ids(perguntas["vivencia"]), sep],
            [cls, *self.ids(FALA), sep, *self.ids(perguntas["risco"]), sep],
            [cls, *self.ids(perguntas["generico"]), sep, *self.ids("fim0"), sep]])

    def test_so_o_trecho_e_cortado_e_a_fala_longa_nao_derruba_o_par(self):
        cls, sep = self.tok.token_to_id("[CLS]"), self.tok.token_to_id("[SEP]")
        juiz_pequeno.principal(FALA, [self.longo])
        juiz_pequeno.vivencia(self.longo)
        cortado, fala_longa = self.linhas()
        espaco = juiz_pequeno.MAX_TOKENS - 3 - len(self.ids(FALA))
        self.assertEqual(cortado, [cls, *self.ids(FALA), sep, *self.ids(self.longo)[:espaco], sep])
        metade = juiz_pequeno.MAX_TOKENS // 2
        self.assertEqual(fala_longa, [cls, *self.ids(self.longo)[:metade], sep,
                                      *self.ids(juiz_pequeno.PERGUNTAS["vivencia"]), sep])

    def test_carrega_uma_sessao_so_quando_pedido_e_a_divide_entre_threads(self):
        self.assertEqual(juiz_pequeno.generico([]), [])
        self.assertEqual(Sessao.criadas, [])
        with ThreadPoolExecutor(4) as threads:
            notas = list(threads.map(juiz_pequeno.vivencia, [FALA] * 8))
        self.assertEqual(len(set(notas)), 1)
        sessao, = Sessao.criadas
        self.assertEqual(sessao.caminho, str(self.raiz / "onnx" / juiz_pequeno.ONNX))
        self.assertEqual((sessao.opcoes.intra_op_num_threads, sessao.opcoes.inter_op_num_threads),
                         (juiz_pequeno.THREADS, 1))
        self.assertEqual(sessao.providers, ["CPUExecutionProvider"])


if __name__ == "__main__":
    unittest.main()
