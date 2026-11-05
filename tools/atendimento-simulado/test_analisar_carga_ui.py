import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import analisar_carga_ui


def consulta(frase, enviada, respondida, trechos=(), **resposta):
    cartoes = [{"trecho_id": t, "titulo": "Livro", "pagina": 1, "texto": "x", "citacao_literal": "x", "probabilidade": 0.9} for t in trechos]
    return {"frase": frase, "enviadaEm": enviada, "respondidaEm": respondida, "status": 200, "resposta": {"cartoes": cartoes, **resposta}}


def marca(id_, frase, em):
    return {"id": id_, "frase": frase, "emMs": em, "naJanela": True}


def sessao(consultas, na_tela):
    frases = [{"frase": f, "fimEm": fim} for f, fim in (("Tenho medo.", 1000), ("Não durmo.", 2000), ("Estou triste.", 3000), ("Fim.", 3600))]
    return {"id": "sessao-001", "tema": "t", "visivel": False, "inicio": 0, "fim": 9000, "erros": [], "falasPaciente": ["a"],
            "frasesPaciente": frases, "naTela": na_tela, "gravacaoEncerradaEm": 3150, "sessaoEncerradaEm": 4000, "consultas": consultas}


class ReconciliarTest(unittest.TestCase):
    def test_cada_resposta_com_cartao_e_cada_frase_terminam_num_desfecho(self):
        r = analisar_carga_ui.reconciliar(sessao([
            consulta("Não durmo.", 2100, 2900, ["t1"]),
            consulta("Tenho medo.", 3100, 3150, ["t1"]),
            consulta("Estou triste.", 3200, 3300, ["t2"]),
            consulta("Estou triste.", 3400, 3500, ["t3"]),
            consulta("Tenho medo. Não durmo.", 3600, 3700, ["t1"]),
            consulta("Fim.", 3700, 4100, ["t4"]),
        ],[marca("2000:paciente", "Não durmo.", 2950), marca("3000:paciente", "Estou triste.", 3550)]))

        self.assertEqual([c["desfecho"] for c in r["cartoes"]],
                         ["na_tela", "trecho_repetido", "superada", "na_tela", "filtrada_por_ancora", "sessao_encerrada"])
        self.assertEqual(r["frases"], {"consultada_ao_vivo": 2, "adiada_por_idade": 2})
        self.assertEqual(r["fim"]["Tenho medo. Não durmo."], 2000)
        self.assertEqual(r["sem_frase"], [])

    def test_cartao_que_nao_apareceu_e_consulta_sem_frase_ficam_sem_explicacao(self):
        r = analisar_carga_ui.reconciliar(sessao([consulta("Tenho medo.", 1100, 1500, ["t1"]), consulta("Outra coisa", 1600, 1700)], []))

        self.assertEqual([c["desfecho"] for c in r["cartoes"]], ["sem_explicacao"])
        self.assertEqual(r["sem_frase"], ["Outra coisa"])
        self.assertEqual(r["frases"]["nunca_consultada"], 3)

    def test_a_analise_grava_o_resumo_e_falha_quando_ha_desfecho_sem_explicacao(self):
        with tempfile.TemporaryDirectory() as pasta:
            raiz = Path(pasta)
            (raiz / "sessoes").mkdir()
            (raiz / "sessoes/sessao-001.json").write_text(json.dumps(sessao([consulta("Tenho medo.", 1100, 1500, ["t1"])], [])), encoding="utf-8")
            with patch.object(analisar_carga_ui, "PASTA", raiz), patch("builtins.print"):
                with self.assertRaisesRegex(SystemExit, "sem explicação"):
                    analisar_carga_ui.main()
            self.assertEqual(json.loads((raiz / "resumo.json").read_text(encoding="utf-8"))["desfechos_das_respostas_com_cartao"], {"sem_explicacao": 1})

    def test_sessao_sem_marcas_lidas_falha(self):
        with self.assertRaisesRegex(ValueError, "não foram lidas"):
            analisar_carga_ui.reconciliar(sessao([], None))


if __name__ == "__main__":
    unittest.main()
