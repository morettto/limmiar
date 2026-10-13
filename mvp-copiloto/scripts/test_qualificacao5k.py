import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "juiz_v2"))
import gerar_frases
import qualificar5k
import revisao_html
import avaliar_5k
import rotulos_5k


def resultado(id_, tipo, cartoes, **extra):
    return {"id": id_, "tipo": tipo, "idioma": "pt-BR", "fala": f"fala {id_}", "cartoes": cartoes, "primeiro_ms": 900.0 if cartoes else None,
            "total_ms": 1200.0, "motivo": None, "alerta_risco": False, "clarificar": False, **extra}


def cartao(n, fonte=False):
    return {"trecho_id": f"t{n}", "arquivo": "obra.pdf", "pagina": n, "paragrafo": 1, "prob": 0.95, "texto": f"trecho {n}", "fonte_exata": fonte, "pagina_da_fonte": fonte}


class Geracao(unittest.TestCase):
    def test_linhas_tira_marcadores_aspas_e_o_que_nao_e_fala(self):
        texto = '- "Eu não consigo mais sair de casa sozinha."\n2. Acordo toda noite com o coração disparado.\ncurto\n* ' + "x" * 400
        self.assertEqual(gerar_frases.linhas(texto), ["Eu não consigo mais sair de casa sozinha.", "Acordo toda noite com o coração disparado."])

    def test_idioma_e_estavel_e_cobre_os_tres(self):
        idiomas = {gerar_frases.idioma_de(f"id{i}") for i in range(200)}
        self.assertEqual(idiomas, {"pt-BR", "en-US", "es"})
        self.assertEqual(gerar_frases.idioma_de("abc"), gerar_frases.idioma_de("abc"))


class Resumo(unittest.TestCase):
    def test_resumo_conta_cartao_fonte_e_alarme_falso_por_tipo(self):
        res = [resultado("p1", "positivo", [cartao(1, True), cartao(2)]), resultado("p2", "positivo", []), resultado("n1", "neutro", []),
               resultado("q1", "quase", [cartao(3)]), resultado("a1", "ambiguo", [], clarificar=True)]
        s = qualificar5k.resumo(res)
        self.assertEqual((s["com_cartao"], s["fonte_exata_em_algum_cartao"], s["cartoes_por_caso_com_cartao"]), ("1/2", "1/2", 2.0))
        self.assertEqual(s["negativos_com_cartao"], {"neutro": "0/1", "quase": "1/1", "ambiguo": "0/1"})
        self.assertEqual(s["ambiguo_pede_esclarecimento"], "1/1")


class Revisao(unittest.TestCase):
    def test_amostra_estratifica_e_nao_passa_do_limite(self):
        res = [resultado(f"p{i}", "positivo", [cartao(i, True), cartao(i + 100)]) for i in range(40)] + [resultado(f"n{i}", "quase", [cartao(i + 200)]) for i in range(40)]
        cards = revisao_html.amostrar(res, 40)
        estratos = {e: sum(c["estrato"] == e for c in cards) for e in ("fonte_exata", "outro_trecho", "negativo")}
        self.assertEqual(len(cards), 40)
        self.assertEqual(estratos, {"fonte_exata": 10, "outro_trecho": 25, "negativo": 5})
        self.assertEqual(len({c["k"] for c in cards}), 40)


class Rotulos(unittest.TestCase):
    cartoes = [{"k": "q5k-positivo-0001|t1", "fala": "f1", "trecho": "x", "obra": "obra-a.pdf", "prob": .95, "estrato": "fonte_exata"},
               {"k": "q5k-positivo-0002|t2", "fala": "f2", "trecho": "y", "obra": "obra-a.pdf", "prob": .93, "estrato": "outro_trecho"},
               {"k": "q5k-positivo-0003|t3", "fala": "f3", "trecho": "z", "obra": "obra-b", "prob": .91, "estrato": "outro_trecho"}]

    def test_duvida_e_sem_resposta_ficam_de_fora(self):
        rows = rotulos_5k.linhas(self.cartoes, {"q5k-positivo-0001|t1": "sim", "q5k-positivo-0002|t2": "duvida"})
        self.assertEqual([(r["fala"], r["alvo"]) for r in rows], [("f1", 1)])

    def test_taxa_de_acerto_por_estrato(self):
        t = rotulos_5k.taxas(self.cartoes, {"q5k-positivo-0001|t1": "sim", "q5k-positivo-0002|t2": "nao", "q5k-positivo-0003|t3": "sim"})
        self.assertEqual((t["fonte_exata"]["acerto"], t["outro_trecho"]["acerto"]), (1.0, 0.5))

    def test_treino_suave_usa_a_nota_inclusive_duvida(self):
        rows = rotulos_5k.linhas_suaves(self.cartoes, {"q5k-positivo-0001|t1": 0.95, "q5k-positivo-0002|t2": 0.8})
        self.assertEqual([(r["alvo_suave"], r["alvo"]) for r in rows], [(0.95, 1), (0.8, 0)])

    def test_obra_fica_de_um_lado_so_com_ou_sem_pdf(self):
        self.assertEqual(rotulos_5k.lado("obra-a.pdf"), rotulos_5k.lado("obra-a"))
        self.assertEqual({rotulos_5k.lado(f"obra-{i}") for i in range(40)}, {"treino", "teste"})


class Avaliacao5k(unittest.TestCase):
    def test_spearman_de_ordens_iguais_e_opostas(self):
        self.assertAlmostEqual(avaliar_5k.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(avaliar_5k.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)

    def test_precisao_e_cobertura_no_limiar_da_nota_sim(self):
        linhas = [{"alvo_suave": n, "prob": p} for n, p in [(0.95, 0.99), (0.5, 0.95), (0.92, 0.2), (0.3, 0.1)]]
        r = avaliar_5k.resumo(linhas)
        self.assertEqual((r["aprovados"], r["precisao_sim"], r["cobertura_sim"]), (2, 0.5, 0.5))


if __name__ == "__main__":
    unittest.main()
