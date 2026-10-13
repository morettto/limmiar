import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, create_autospec, patch

import qualificar_revisado as executar
from qualificar_revisado import COTAS_CASOS, selecionar, estrato


class ProtocoloIndependente(unittest.TestCase):
    def casos(self):
        lista = []
        for tipo, total in COTAS_CASOS.items():
            for i in range(total + 5):
                lista.append({"id": f"{tipo}-{i}", "tipo": "positivo" if tipo in ("geral", "risco") else tipo,
                              "canal": tipo})
        return lista

    def test_selecao_reproduzivel_independe_de_ordem_e_cobre_todos_os_estratos(self):
        casos = self.casos()
        selecionados = selecionar(casos)
        self.assertEqual(selecionados, selecionar(list(reversed(casos))))
        self.assertEqual(len(selecionados), 200)
        for tipo, total in COTAS_CASOS.items():
            self.assertEqual(sum(estrato(c) == tipo for c in selecionados), total)

    def test_nao_aceita_amostra_incompleta_ou_ids_repetidos(self):
        casos = self.casos()
        with self.assertRaisesRegex(ValueError, "duplicados"):
            selecionar(casos + [casos[0]])
        with self.assertRaisesRegex(ValueError, "insuficiente"):
            selecionar([c for c in casos if c["tipo"] != "ambiguo"])

    def test_execucao_percorre_fontes_sem_limite_e_nao_fabrica_latencia_sem_cartoes(self):
        caso = {"id": "sintetico", "fala": "fala", "contexto": [], "falante": "paciente",
                "idioma": "pt-BR", "tipo": "neutro"}
        protocolo = {"casos": [caso], "limiares": {"juiz_geral": 0.964}}
        decisao = executar.decisao.Decisao([], False, False, "nenhum", "sem conteúdo clínico")
        pipeline = create_autospec(executar.decisao.decidir_progressivamente, return_value=iter([decisao]))
        con = Mock()
        con.execute.return_value = []
        with tempfile.TemporaryDirectory() as pasta, patch.object(executar, "DESTINO", Path(pasta)), \
                patch.object(executar, "preparar", return_value=protocolo), \
                patch.object(executar, "conectar", return_value=con), \
                patch.object(executar.busca.INDICE, "recarregar"), \
                patch.object(executar.embedder, "carregar"), patch.object(executar.traducao, "aquecer"), \
                patch.object(executar.treinado, "aquecer"), \
                patch.object(executar.metadados, "versao_pesquisa", return_value={"versao": "teste"}), \
                patch.object(executar.decisao, "decidir_progressivamente", pipeline), \
                patch.object(executar, "resumo", return_value={"a_adjudicar": []}):
            (Path(pasta) / "protocolo.json").write_text(json.dumps(protocolo), encoding="utf-8")
            executar.correr()
            relatorio = json.loads((Path(pasta) / "resumo.json").read_text(encoding="utf-8"))
            pipeline.assert_called_once_with(con, "fala", [], "paciente", "pt-BR",
                                             obras_ids=None, limites=protocolo["limiares"])
            self.assertIsNone(relatorio["primeiro_cartao_p95_ms"])
            self.assertIsNone(relatorio["primeiro_cartao_p95_s"])
            self.assertEqual(relatorio["status"], "PENDENTE_ADJUDICACAO")


if __name__ == "__main__":
    unittest.main()
