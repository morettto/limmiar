import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import treinar


class FontesDev(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.raiz = Path(self.tmp.name)
        self.par = {"id": "r5-0010", "fala": "Trato pacientes como números.", "contexto": ["Tenho trabalhado exausto."],
                    "arquivo": "relacoes.pdf", "pagina": 4, "paragrafo": 8,
                    "trecho": "Há dessensibilização das relações no trabalho.", "tipo": "pos", "alvo": 0.0}
        self.revisao = {k: self.par[k] for k in ("id", "arquivo", "pagina", "paragrafo")}
        self.revisao.update({"valido": True, "justificativa": "O trecho sustenta o distanciamento afetivo no trabalho.",
            "revisor": "Revisor", "fala_sha256": hashlib.sha256(treinar.consulta(self.par["fala"], self.par["contexto"]).encode()).hexdigest(),
            "trecho_sha256": hashlib.sha256(self.par["trecho"].encode()).hexdigest()})
        self.addCleanup(patch.stopall)
        patch.object(treinar, "TREINO", self.raiz).start()
        self.gravar([self.revisao])

    def gravar(self, linhas):
        treinar.gravar_jsonl(self.raiz / "fontes-dev-revisadas.jsonl", linhas)

    def test_preserva_alternativa_valida_e_negativo_revisado_sem_duplicar_ou_mudar_grupo(self):
        outro = {**self.par, "pagina": 6, "trecho": "Só estatísticas de uma amostra religiosa."}
        desconhecido = {**self.par, "pagina": 7}
        negativa = {**self.revisao, "pagina": 6, "valido": False,
                    "trecho_sha256": hashlib.sha256(outro["trecho"].encode()).hexdigest()}
        self.gravar([self.revisao, negativa])
        treinar.gravar_jsonl(self.raiz / "claude-r5.jsonl", [self.par, outro, desconhecido])
        pares = treinar.pares_claude()
        self.assertEqual(len(pares), 3)
        revisados = treinar.rotulos_revisados(pares)
        self.assertEqual([p["alvo"] for p in revisados], [1.0, 0.0])
        self.assertTrue(all(p["origem"] == "fonte-dev" for p in revisados))
        self.assertEqual({p["parte"] for p in revisados}, {treinar.parte(self.par["id"])})
        self.assertEqual({p["grupo"] for p in revisados}, {self.par["id"]})

    def test_recusa_rotulo_fraco_justificativa_ou_revisor_ausente(self):
        for campo, valor in (("valido", 0), ("valido", "false"), ("valido", None),
                             ("justificativa", " "), ("justificativa", None), ("revisor", ""), ("revisor", True)):
            with self.subTest(campo=campo, valor=valor):
                self.gravar([{**self.revisao, campo: valor}])
                with self.assertRaisesRegex(ValueError, "booleano estrito"):
                    treinar.fontes_dev_revisadas([self.par])

    def test_mudanca_de_fala_contexto_passagem_ou_hash_invalida_revisao(self):
        for campo, valor in (("fala", "Outra experiência."), ("contexto", ["Foi meu vizinho quem relatou isso."]),
                             ("trecho", "Outra passagem.")):
            with self.subTest(campo=campo):
                with self.assertRaisesRegex(ValueError, "mudaram"):
                    treinar.fontes_dev_revisadas([{**self.par, campo: valor}])
        for campo in ("fala_sha256", "trecho_sha256"):
            self.gravar([{**self.revisao, campo: "0" * 64}])
            with self.assertRaisesRegex(ValueError, "mudaram"):
                treinar.fontes_dev_revisadas([self.par])

    def test_recusa_teste_final_passagem_desconhecida_e_duplicacao(self):
        for cid in ("teste-pos-0093", "final100-01", "dev-inexistente"):
            self.gravar([{**self.revisao, "id": cid}])
            with self.assertRaisesRegex(ValueError, "fora do desenvolvimento"):
                treinar.fontes_dev_revisadas([{**self.par, "id": cid}])
        self.gravar([{**self.revisao, "pagina": 99}])
        with self.assertRaisesRegex(ValueError, "fora do desenvolvimento"):
            treinar.fontes_dev_revisadas([self.par])
        self.gravar([self.revisao, copy.deepcopy(self.revisao)])
        with self.assertRaisesRegex(ValueError, "duplicada"):
            treinar.fontes_dev_revisadas([self.par])

    def test_contraste_exige_mesma_fala_e_contexto_com_fonte_positiva_e_negativo_revisado(self):
        pares = [{"q": "Experiência própria", "alvo": 1, "origem": "caso"},
                 {"q": "Experiência própria", "alvo": 0, "origem": "fonte-dev"},
                 {"q": "Citando outra pessoa", "alvo": 0, "origem": "contexto-dev"},
                 {"q": "Relato sem fonte positiva", "alvo": 0, "origem": "fonte-dev"},
                 {"q": "Outra fala clínica", "alvo": 1, "origem": "caso"},
                 {"q": "Outra fala clínica", "alvo": 0, "origem": "jev"}]
        marcados = treinar.marcar_contrastes_fontes(pares)
        self.assertEqual([p["contraste_fonte"] for p in marcados], [True, True, False, False, False, False])
        self.assertNotIn("contraste_fonte", pares[0])


if __name__ == "__main__":
    unittest.main()
