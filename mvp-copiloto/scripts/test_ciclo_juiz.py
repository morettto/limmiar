import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "juiz_v2"))
import ciclo
from copiloto import votos as feedback
import rotulos_5k
import teste_fixo

FALA, TRECHO = "não consigo respirar quando chego perto do elevador", "O medo de espaços fechados leva à evitação e à sensação de falta de ar."


def evento(usuario, voto, fala=FALA, trecho=TRECHO, **extra):
    return {"v": 1, "consentiu": True, "usuario": usuario, "fala": fala, "contexto": [], "trecho": trecho, "obra": "obra.pdf",
            "voto": voto, "juiz": "v1", "em": "2026-10-08T10:00:00Z", **extra}


lado_treino = next(f"o{i}.pdf" for i in range(99) if rotulos_5k.lado(f"o{i}.pdf") == "treino")
lado_teste = next(f"o{i}.pdf" for i in range(99) if rotulos_5k.lado(f"o{i}.pdf") == "teste")


class Feedback(unittest.TestCase):
    def test_sem_consentimento_ou_malformado_nao_entra(self):
        self.assertEqual(feedback.limpar([evento("u1", "util", consentiu=False), {"v": 1}, evento("u1", "talvez")]), [])

    def test_ultimo_voto_do_usuario_vale_e_maioria_decide(self):
        antigo = evento("u1", "util", em="2026-10-01T00:00:00Z")
        novo = evento("u1", "nao_util", em="2026-10-02T00:00:00Z")
        linhas = feedback.limpar([antigo, novo, evento("u2", "nao_util"), evento("u3", "util")])
        self.assertEqual([(r["alvo"], r["usuarios"]) for r in linhas], [(0, 3)])

    def test_empate_e_poucos_usuarios_e_teste_fixo_e_nao_prosa_ficam_de_fora(self):
        self.assertEqual(feedback.limpar([evento("u1", "util"), evento("u2", "nao_util")]), [])
        self.assertEqual(feedback.limpar([evento("u1", "util")], minimo_usuarios=2), [])
        self.assertEqual(feedback.limpar([evento("u1", "util")], excluir={feedback.chave(FALA, TRECHO)}), [])
        self.assertEqual(feedback.limpar([evento("u1", "util")], prosa=lambda t: False), [])


class TesteFixo(unittest.TestCase):
    def test_obra_de_teste_e_estavel_e_cerca_de_uma_em_cinco(self):
        nomes = [f"obra-{i}.pdf" for i in range(500)]
        marcadas = [n for n in nomes if teste_fixo.obra_de_teste(n)]
        self.assertEqual(marcadas, [n for n in nomes if teste_fixo.obra_de_teste(n)])
        self.assertTrue(70 < len(marcadas) < 130)

    def test_mesma_obra_com_e_sem_pdf_cai_do_mesmo_lado(self):
        for i in range(60):
            nome = f"pt-br-0{i}-uma-obra-com-nome-longo-o-bastante-para-passar-de-cinquenta-letras"
            self.assertEqual(teste_fixo.obra_de_teste(nome), teste_fixo.obra_de_teste(nome + ".pdf"))
            self.assertEqual(teste_fixo.obra_de_teste(nome), teste_fixo.obra_de_teste(nome[:57]))

    def test_fixo_tem_obras_de_teste_e_voto_do_usuario_vence_a_base(self):
        de_teste = next(f"o{i}.pdf" for i in range(99) if teste_fixo.obra_de_teste(f"o{i}.pdf"))
        de_treino = next(f"o{i}.pdf" for i in range(99) if not teste_fixo.obra_de_teste(f"o{i}.pdf"))
        base = [{"fala": "a", "contexto": [], "trecho": "x", "arquivo": de_teste, "alvo": 1, "origem": "caso"},
                {"fala": "b", "contexto": [], "trecho": "y", "arquivo": de_treino, "alvo": 1, "origem": "caso"}]
        usuario = [teste_fixo.linha({"id": "i", "fala": "a", "contexto": [], "trecho": "x", "arquivo": "u", "alvo": 0, "origem": "rotulo_usuario"})]
        fixo = teste_fixo.montar(base, usuario)
        self.assertEqual([(r["fala"], r["alvo"], r["origem"]) for r in fixo], [("a", 0, "rotulo_usuario")])
        fixos = {r["trecho_id"] for r in fixo}
        self.assertFalse(teste_fixo.treino_permitido(base[0], fixos))
        self.assertTrue(teste_fixo.treino_permitido(base[1], fixos))

    def test_respostas_do_usuario_ignoram_duvida(self):
        cartoes = [{"k": "c1|t1", "fala": "f1", "ctx": [], "trecho": "t", "obra": "o"}, {"k": "c2|t2", "fala": "f2", "ctx": [], "trecho": "t", "obra": "o"}]
        linhas = teste_fixo.rotulos_do_usuario(cartoes, {"c1|t1": "sim", "c2|t2": "duvida"})
        self.assertEqual([(r["fala"], r["alvo"]) for r in linhas], [("f1", 1)])


def previsoes(n, melhor):
    azar = random.Random(4)
    linhas = []
    for i in range(n):
        alvo = int(azar.random() < 0.4)
        ruido = azar.random() * 0.3
        base = (0.65 if alvo else 0.35) if melhor else 0.5
        linhas.append({"trecho_id": str(i), "alvo": alvo, "origem": "dificil", "prob": min(1, max(0, base + (ruido if alvo else -ruido) * (1 if melhor else azar.choice([-1, 1]))))})
    return linhas


class Promocao(unittest.TestCase):
    def test_auroc_por_postos_confere_com_a_conta_direta(self):
        pares = [(0.9, 1), (0.8, 0), (0.8, 1), (0.1, 0), (0.1, 0)]
        direto = sum((p > n) + 0.5 * (p == n) for p, a in pares if a for n, b in pares if not b) / (2 * 3)
        self.assertAlmostEqual(ciclo.auroc(pares), direto)

    def test_promove_quando_melhora_e_barra_quando_piora_ou_falta_dado(self):
        bom, ruim = previsoes(300, True), previsoes(300, False)
        self.assertTrue(ciclo.veredito(bom, ruim, reamostras=200)["promover"])
        pior = ciclo.veredito(ruim, bom, reamostras=200)
        self.assertFalse(pior["promover"])
        self.assertTrue(pior["razoes"])
        poucos = ciclo.veredito(bom[:50], ruim[:50], reamostras=50)
        self.assertFalse(poucos["promover"])

    def test_com_notas_do_profissional_a_melhora_vem_delas_e_o_teste_fixo_so_barra_regressao(self):
        fixo = previsoes(300, True)
        notas = lambda prob: [{"alvo_suave": n, "prob": p} for n, p in zip(
            [0.95, 0.5, 0.92, 0.3, 0.96, 0.4, 0.2, 0.91, 0.1, 0.35], prob, strict=True)]
        ruim, bom = notas([0.90, 0.95, 0.91, 0.96, 0.92, 0.97, 0.98, 0.93, 0.99, 0.94]), notas([0.97, 0.3, 0.95, 0.2, 0.96, 0.35, 0.1, 0.93, 0.05, 0.25])
        self.assertTrue(ciclo.veredito(fixo, fixo, reamostras=100, notas=(bom, ruim))["promover"])
        sem_melhora = ciclo.veredito(fixo, fixo, reamostras=100, notas=(ruim, ruim))
        self.assertFalse(sem_melhora["promover"])
        self.assertEqual(len(sem_melhora["razoes"]), 2)
        self.assertFalse(ciclo.veredito(previsoes(300, False), fixo, reamostras=100, notas=(bom, ruim))["promover"])

    def test_montar_tira_teste_fixo_e_obra_de_teste_do_treino(self):
        de_teste = next(f"o{i}.pdf" for i in range(99) if teste_fixo.obra_de_teste(f"o{i}.pdf"))
        base = [{"fala": "b", "contexto": [], "trecho": "y", "arquivo": "treino.pdf" if not teste_fixo.obra_de_teste("treino.pdf") else "t2.pdf", "alvo": 1, "origem": "caso"},
                {"fala": "a", "contexto": [], "trecho": "x", "arquivo": de_teste, "alvo": 1, "origem": "caso"}]
        linhas, _ = ciclo.montar([evento("u1", "util", obra=lado_treino)], base, set())
        self.assertEqual(sorted(r["fala"] for r in linhas), sorted(["b", FALA]))

    def test_votos_de_obras_do_lado_teste_medem_a_melhora_e_nunca_treinam(self):
        votos = [evento("u1", "util", obra=lado_treino), evento("u1", "nao_util", fala="outra fala longa o bastante para ser outro par", obra=lado_teste)]
        linhas, teste = ciclo.montar(votos, [], set())
        self.assertEqual([r["fala"] for r in linhas], [FALA])
        self.assertEqual([(r["alvo"], r["alvo_suave"]) for r in teste], [(0, 0.0)])


if __name__ == "__main__":
    unittest.main()
