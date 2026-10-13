from __future__ import annotations

import sys
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import metadados
from copiloto.esquema import criar_esquema


class IntegridadeArtefatos(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.addCleanup(self.pasta.cleanup)
        self.raiz = Path(self.pasta.name)
        self.bd = self.raiz / "acervo.db"
        self.pdfs = self.raiz / "pdfs"
        self.pdfs.mkdir()
        self.pesos = self.raiz / "modelo.bin"
        self.pesos.write_bytes(b"pesos sinteticos")
        for campo, valor in (("CAMINHO_BD", self.bd), ("DIR_PDFS", self.pdfs), ("RAIZ", self.raiz)):
            p = patch.object(metadados, campo, valor)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(metadados, "arquivos_modelo", return_value=[self.pesos])
        p.start()
        self.addCleanup(p.stop)

    def test_hash_indexado_muda_com_fonte_texto_embedding_e_remocao(self):
        self.assertIsNone(metadados.hash_indice())
        with closing(sqlite3.connect(self.bd)) as con:
            criar_esquema(con)
            con.execute("insert into obra (id,titulo,autor,idioma,arquivo,arquivo_hash) values (?,?,?,?,?,?)",
                        ("o1", "Título", "Autor", "pt-BR", "fonte.pdf", "hash"))
            con.execute("insert into trecho (id,obra_id,pagina,paragrafo,texto,idioma,embedding) values (?,?,?,?,?,?,?)",
                        ("t1", "o1", 1, 1, "Texto original", "pt-BR", b"embedding"))
            con.commit()
            hashes = [metadados.hash_indice()]
            self.assertEqual(hashes[0], metadados.hash_indice())
            for sql in ("update obra set titulo='Outra obra'", "update trecho set texto='Outro texto'",
                        "update trecho set embedding=x'010203'", "delete from trecho"):
                con.execute(sql)
                con.commit()
                hashes.append(metadados.hash_indice())
            self.assertEqual(len(set(hashes)), len(hashes))

    def test_estado_detecta_so_mudanca_no_codigo(self):
        fontes = self.raiz / "src"
        fontes.mkdir()
        with patch.object(metadados, "FONTES", fontes):
            self.assertEqual(metadados.estado_arquivos(), {})
            codigo = fontes / "modulo.py"
            codigo.write_text("x = 1")
            inicial = metadados.estado_arquivos()
            self.assertEqual(inicial, metadados.estado_arquivos())
            codigo.write_text("x = 22")
            self.assertNotEqual(inicial, metadados.estado_arquivos())
            (self.pdfs / "fonte.pdf").write_bytes(b"PDF sintetico")
            self.pesos.write_bytes(b"pesos alterados")
            self.assertEqual(set(metadados.estado_arquivos()), {str(codigo)})

    def test_versao_do_produto_e_a_do_juiz_mais_contrato_e_codigo(self):
        with patch.object(metadados, "hashes", return_value={"arquivo": "hash"}),              patch.object(metadados.juiz_llm, "VERSAO", "v7"):
            versao = metadados.versao()
        self.assertEqual(versao["contrato"], "fontes-progressivas-frase-v4")
        self.assertEqual(versao["juiz"], "v7")
        self.assertEqual(versao["source_hashes"], {"arquivo": "hash"})
        for saiu in ("pdf_hashes", "indice_sha256", "model_hashes"):
            self.assertNotIn(saiu, versao)

    def test_versao_de_pesquisa_acrescenta_modelos_pdfs_e_indice(self):
        with patch.object(metadados, "hash_indice", return_value="hash-indice"),              patch.object(metadados, "hashes", return_value={"arquivo": "hash"}):
            versao = metadados.versao_pesquisa()
        self.assertEqual(versao["indice_sha256"], "hash-indice")
        self.assertEqual(versao["pdf_hashes"], {"arquivo": "hash"})
        self.assertEqual(versao["model_hashes"], {"arquivo": "hash"})
        self.assertEqual(versao["juiz"], metadados.juiz_llm.VERSAO)

    def test_hashes_ignoram_diretorios(self):
        hashes = metadados.hashes([self.pesos, self.pdfs])
        self.assertEqual(set(hashes), {"modelo.bin"})
        self.assertEqual(len(hashes["modelo.bin"]), 64)


if __name__ == "__main__":
    unittest.main()
