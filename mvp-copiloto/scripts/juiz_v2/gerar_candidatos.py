"""Top-K da busca do produto para cada caso do desenvolvimento. Uso: gerar_candidatos.py K SAIDA.jsonl."""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src"), str(RAIZ / "scripts")]
from copiloto import busca, embedder, treinado
from copiloto.esquema import conectar
from avaliar import adjudicacoes, casos


def main() -> None:
    k, saida = int(sys.argv[1]), sys.argv[2]
    reescritas = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8")) if len(sys.argv) > 3 else {}
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    adjud = adjudicacoes("dev")
    cortes = (10, 20, 30, 50, 100, 200, 400)
    recall = {c: 0 for c in cortes}
    positivos = 0
    with open(saida, "w", encoding="utf-8") as f:
        for caso in casos("dev"):
            todos = busca.candidatos_amplos(con, treinado.consulta(caso["fala"], caso["contexto"]), caso["idioma"], max(cortes),
                                            extras=reescritas.get(caso["id"]))
            achados = todos[:k]
            fonte = caso.get("fonte") or {}
            paginas = {(a["arquivo"], int(a["pagina"])) for a in caso.get("alvos", [])}
            if caso["tipo"] == "positivo":
                positivos += 1
                for corte in cortes:
                    recall[corte] += any((c.arquivo, c.pagina) in paginas for c in todos[:corte])
            for rank, c in enumerate(achados):
                exato = (c.arquivo, c.pagina, c.paragrafo) == (fonte.get("arquivo"), fonte.get("pagina"), fonte.get("paragrafo"))
                ouro = True if exato else adjud.get((caso["id"], c.arquivo, c.pagina, c.paragrafo), adjud.get((caso["id"], c.arquivo, c.pagina)))
                f.write(json.dumps({"id": caso["id"], "tipo": caso["tipo"], "canal": caso.get("canal"), "fala": caso["fala"],
                                    "contexto": caso["contexto"], "trecho": c.texto, "trecho_id": c.trecho_id, "arquivo": c.arquivo,
                                    "pagina": c.pagina, "paragrafo": c.paragrafo, "rank": rank,
                                    "ouro": ouro, "pagina_alvo": (c.arquivo, c.pagina) in paginas,
                                    "alvo": 1 if ouro else 0, "origem": caso["tipo"]}, ensure_ascii=False) + "\n")
    print("recall da página-alvo:", {c: round(v / positivos, 3) for c, v in recall.items()}, flush=True)


if __name__ == "__main__":
    main()
