import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "juiz_v2"))
from avaliar_portao import avaliar


def caso(tipo, canal, clinica, risco, ambigua=0.0):
    return {"tipo": tipo, "canal": canal, "clinica": clinica, "risco": risco, "ambigua": ambigua}


class AvaliarPortao(unittest.TestCase):
    def test_alarme_falso_por_tipo_e_recall_por_limiar(self):
        casos = [caso("neutro", "nenhum", 0.6, 0.0), caso("neutro", "nenhum", 0.1, 0.0), caso("quase", "nenhum", 0.1, 0.8),
                 caso("positivo", "geral", 0.9, 0.0), caso("positivo", "geral", 0.4, 0.0), caso("positivo", "risco", 0.2, 0.3, 0.7)]
        baixo, alto = avaliar(casos, (0.3, 0.7))
        self.assertEqual((baixo["alarme_neutro"], alto["alarme_neutro"]), (0.5, 0.0))
        self.assertEqual((baixo["alarme_quase"], alto["alarme_quase"]), (1.0, 1.0))
        self.assertIsNone(baixo["alarme_terapeuta"])
        self.assertEqual((baixo["recall_clinica"], alto["recall_clinica"]), (1.0, 0.5))
        self.assertEqual((baixo["recall_risco"], alto["recall_risco"]), (1.0, 1.0))


if __name__ == "__main__":
    unittest.main()
