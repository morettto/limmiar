"""Compara a taxa de acerto da busca com e sem reescrita. Uso: recall_reescrita.py REESCRITAS.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src"), str(RAIZ / "scripts")]
from copiloto import busca, embedder, treinado
from copiloto.esquema import conectar
from avaliar import casos

CORTES = (10, 20, 30, 50, 100, 200)


def main() -> None:
    reescritas = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    con = conectar()
    busca.INDICE.recarregar(con)
    embedder.carregar(busca.INDICE.modelo)
    variantes = {"base": lambda c, r: dict(frase=treinado.consulta(c["fala"], c["contexto"])),
                 "base+reescrita": lambda c, r: dict(frase=treinado.consulta(c["fala"], c["contexto"]), extras=r),
                 "so_reescrita": lambda c, r: dict(frase=r[0], extras=r[1:])}
    acertos = {v: {k: 0 for k in CORTES} for v in variantes}
    total = nenhuma = 0
    for c in casos("dev"):
        if c["tipo"] != "positivo":
            continue
        total += 1
        r = reescritas.get(c["id"]) or []
        nenhuma += not r
        paginas = {(a["arquivo"], int(a["pagina"])) for a in c["alvos"]}
        for nome, montar in variantes.items():
            if nome == "so_reescrita" and not r:
                continue
            achados = busca.candidatos_amplos(con, idioma=c["idioma"], limite=max(CORTES), **montar(c, r)) if r or nome == "base" else []
            for k in CORTES:
                acertos[nome][k] += any((a.arquivo, a.pagina) in paginas for a in achados[:k])
    print(f"positivos {total}, sem reescrita {nenhuma}")
    for nome, por in acertos.items():
        print(f"{nome:16}", {k: round(v / total, 3) for k, v in por.items()})


if __name__ == "__main__":
    main()
