"""O codificador da busca com um tokenizador minúsculo de verdade e a sessão ONNX trocada na fronteira: corte, lotes por
tamanho, ordem e normalização. Nesta máquina `import onnxruntime` custa 80 s (platform.system() espera o WMI), daí o duplo."""
import sqlite3
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
from copiloto import busca, embedder
from copiloto.esquema import criar_esquema

INICIO, PAD, FIM = 0, 1, 2


def tokenizador(textos: list[str]) -> Tokenizer:
    vocabulario = {"<s>": INICIO, "<pad>": PAD, "</s>": FIM, "<unk>": 3}
    for palavra in sorted({p for texto in textos for p, _ in pre_tokenizers.Whitespace().pre_tokenize_str(texto)}):
        vocabulario[palavra] = len(vocabulario)
    tok = Tokenizer(models.WordLevel(vocabulario, unk_token="<unk>"))
    tok.pre_tokenizer = pre_tokenizers.Whitespace()
    tok.post_processor = processors.TemplateProcessing(single="<s> $A </s>", special_tokens=[("<s>", INICIO), ("</s>", FIM)])
    return tok


class Sessao:
    """sentence_embedding = (soma dos ids reais, quantos tokens reais, 1), sem normalizar, uma linha por texto do lote."""
    criadas: list["Sessao"] = []

    def __init__(self, caminho, opcoes, providers):
        self.caminho, self.opcoes, self.providers, self.lotes, self.execucoes = caminho, opcoes, providers, [], []
        Sessao.criadas.append(self)

    def run(self, saidas, entradas, execucao):
        self.lotes.append(entradas)
        self.execucoes.append(execucao)
        ids, mascara = entradas["input_ids"], entradas["attention_mask"]
        return [np.stack([(ids * mascara).sum(axis=1), mascara.sum(axis=1), np.ones(len(ids))], axis=1).astype(np.float32)]


ORT = types.SimpleNamespace(SessionOptions=types.SimpleNamespace, RunOptions=Mock, InferenceSession=Sessao)


class Embedder(unittest.TestCase):
    def setUp(self):
        self.textos = [" ".join([f"p{k}" for k in range(n)] + [f"fim{i}"])
                       for i, n in enumerate([5, 1, 9, 3, 12, 2, 7, 4, 10, 6, 8])]
        self.longo = " ".join(f"p{k}" for k in range(600))
        self.tok = tokenizador([self.longo, *self.textos])
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        self.raiz = Path(pasta.name)
        self.tok.save(str(self.raiz / "tokenizer.json"))
        Sessao.criadas = []
        for alvo in (patch.object(embedder, "PASTA", self.raiz), patch.object(embedder, "_CARREGADO", []),
                     patch.dict(sys.modules, {"onnxruntime": ORT})):
            alvo.start()
            self.addCleanup(alvo.stop)

    def linhas(self) -> list[list[int]]:
        return [[int(t) for t, m in zip(ids, mascara) if m]
                for lote in Sessao.criadas[0].lotes for ids, mascara in zip(lote["input_ids"], lote["attention_mask"])]

    def test_vetores_voltam_na_ordem_da_entrada_normalizados_em_lotes_de_ate_oito_por_tamanho(self):
        vetores = embedder.codificar_consultas(self.textos)
        self.assertEqual(vetores.dtype, np.float32)
        for vetor, texto in zip(vetores, self.textos, strict=True):
            ids = self.tok.encode(texto).ids
            esperado = np.array([sum(ids), len(ids), 1.0])
            self.assertTrue(np.allclose(vetor, esperado / np.linalg.norm(esperado), rtol=1e-6), (texto, vetor))
        lotes = Sessao.criadas[0].lotes
        self.assertEqual([len(lote["input_ids"]) for lote in lotes], [8, 3])
        larguras = [len(ids) for ids in self.linhas()]
        self.assertEqual(larguras, sorted(larguras), "lotes montados do texto mais curto ao mais longo")
        for lote in lotes:
            self.assertEqual(lote["input_ids"].shape[1], int(lote["attention_mask"].sum(axis=1).max()), "sem padding a mais")
            self.assertTrue((lote["input_ids"][lote["attention_mask"] == 0] == PAD).all(), "o padding usa <pad>")

    def test_texto_longo_vai_cortado_em_512_tokens_com_o_fecho(self):
        embedder.codificar_documentos([self.longo])
        cortado, = self.linhas()
        self.assertEqual(len(cortado), embedder.MAX_TOKENS)
        self.assertEqual(cortado, [INICIO, *self.tok.encode(self.longo, add_special_tokens=False).ids[:510], FIM])

    def test_carrega_uma_sessao_so_quando_pedido_e_a_divide_entre_threads(self):
        self.assertEqual(Sessao.criadas, [])
        with ThreadPoolExecutor(4) as threads:
            vetores = list(threads.map(embedder.codificar_consultas, [[self.textos[0]]] * 8))
        self.assertEqual({v.tobytes() for v in vetores}, {vetores[0].tobytes()})
        sessao, = Sessao.criadas
        self.assertEqual(sessao.caminho, str(self.raiz / embedder.ONNX))
        self.assertEqual((sessao.opcoes.intra_op_num_threads, sessao.opcoes.inter_op_num_threads), (embedder.THREADS, 1))
        self.assertEqual(sessao.providers, ["CPUExecutionProvider"])
        sessao.execucoes[0].add_run_config_entry.assert_called_once_with("memory.enable_memory_arena_shrinkage", "cpu:0")


class Identidade(unittest.TestCase):
    def acervo(self, modelo: str) -> sqlite3.Connection:
        con = sqlite3.connect(":memory:")
        con.row_factory = sqlite3.Row
        criar_esquema(con)
        con.execute("insert into obra (id,titulo,autor,idioma,arquivo,arquivo_hash,status,modelo)"
                    " values ('o','t','a','pt-BR','o.pdf','h','pronto',?)", (modelo,))
        con.execute("insert into trecho (id,obra_id,pagina,paragrafo,texto,idioma,embedding,generico)"
                    " values ('o:1:1','o',1,1,?,'pt-BR',?,0)",
                    ("Patients described avoidance of the street where the accident happened, for months afterwards.",
                     np.ones(2, dtype=np.float32).tobytes()))
        return con

    def test_vetores_de_outro_codificador_nao_entram_na_busca(self):
        indice = busca.Indice()
        indice.recarregar(self.acervo(embedder.PADRAO))
        self.assertEqual(indice.ids, ["o:1:1"])
        with self.assertRaises(ValueError):
            busca.Indice().recarregar(self.acervo("BAAI/bge-m3"))


if __name__ == "__main__":
    unittest.main()
