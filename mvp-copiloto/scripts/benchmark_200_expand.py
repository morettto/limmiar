from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

from copiloto import busca  # noqa: E402
from copiloto.esquema import conectar, criar_esquema  # noqa: E402


REGISTOS = RAIZ / "resultados" / "benchmark_200_registos.jsonl"
SAIDA = RAIZ / "resultados" / "benchmark_200_top200.json"


def main() -> None:
    registros = [json.loads(linha) for linha in REGISTOS.read_text(encoding="utf-8").splitlines() if linha]
    con = conectar()
    criar_esquema(con)
    busca.INDICE.recarregar(con)
    melhoras = 0
    top200 = 0
    exatos = 0
    for indice, registro in enumerate(registros, 1):
        alvos = {tuple(item) for item in registro["alvos"]}
        fonte = tuple(registro["fonte"]) if registro["fonte"] else None
        candidatos = busca.candidatos_amplos(
            con,
            registro["fala"],
            registro["idioma"],
            limite=200,
            profundidade=200,
            por_obra=1000,
        )
        pagina = None
        paragrafo = None
        for posicao, candidato in enumerate(candidatos):
            if pagina is None and (candidato.arquivo, candidato.pagina) in alvos:
                pagina = posicao
            if paragrafo is None and fonte == (candidato.arquivo, candidato.pagina, candidato.paragrafo):
                paragrafo = posicao
        if pagina is not None:
            top200 += 1
            if registro["posicao_pagina"]["100"] is None:
                melhoras += 1
        if paragrafo is not None:
            exatos += 1
        if indice % 10 == 0:
            print(f"{indice}/{len(registros)}", flush=True)
    total = len(registros)
    resumo = {
        "casos": total,
        "top200_pagina": top200,
        "top200_pagina_taxa": round(top200 / total, 4),
        "top200_paragrafo": exatos,
        "top200_paragrafo_taxa": round(exatos / total, 4),
        "melhorias_sobre_top100": melhoras,
        "meta": 0.9,
        "passa": top200 / total >= 0.9,
    }
    SAIDA.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
