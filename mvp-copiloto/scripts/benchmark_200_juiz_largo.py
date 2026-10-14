from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

from copiloto import busca, treinado  # noqa: E402
from copiloto.esquema import conectar, criar_esquema  # noqa: E402


TOTAL = int(os.environ.get("COPILOTO_AMOSTRA_JUIZ", "40"))
TOP = int(os.environ.get("COPILOTO_TOP_JUIZ", "200"))
LIMIARES = (0.5, 0.65, 0.75, 0.9)
CASOS = RAIZ / "data" / "avaliacao" / "benchmark_200.jsonl"
SAIDA = RAIZ / "resultados" / "benchmark_200_juiz_largo.json"


def main() -> None:
    casos = [json.loads(linha) for linha in CASOS.read_text(encoding="utf-8").splitlines() if linha]
    casos = casos[:TOTAL]
    con = conectar()
    criar_esquema(con)
    busca.INDICE.recarregar(con)
    treinado.aquecer()
    sinais = {limiar: 0 for limiar in LIMIARES}
    corretos = {limiar: 0 for limiar in LIMIARES}
    incorretos = {limiar: 0 for limiar in LIMIARES}
    encontrou_pagina = 0
    tempos: list[float] = []
    for indice, caso in enumerate(casos, 1):
        alvos = {(item["arquivo"], item["pagina"]) for item in caso["alvos"]}
        inicio = time.perf_counter()
        candidatos = busca.candidatos_amplos(
            con, caso["fala"], caso["idioma"], limite=TOP, profundidade=TOP, por_obra=1000
        )
        notas = treinado.julgar(caso["fala"], caso.get("contexto", []), [c.texto for c in candidatos])
        tempos.append((time.perf_counter() - inicio) * 1000)
        paginas = [i for i, c in enumerate(candidatos) if (c.arquivo, c.pagina) in alvos]
        if paginas:
            encontrou_pagina += 1
        for limiar in LIMIARES:
            bons = [i for i, nota in enumerate(notas) if nota >= limiar]
            bons_alvo = [i for i in bons if i in paginas]
            if bons_alvo:
                sinais[limiar] += 1
            if bons:
                escolhido = max(bons, key=lambda i: notas[i])
                if escolhido in paginas:
                    corretos[limiar] += 1
                else:
                    incorretos[limiar] += 1
        if indice % 10 == 0:
            print(f"{indice}/{len(casos)}", flush=True)
    ordenados = sorted(tempos)
    resultado = {
        "casos": len(casos),
        "top": TOP,
        "modelo": treinado.NOME_JUIZ,
        "pagina_encontrada": encontrou_pagina,
        "pagina_encontrada_taxa": round(encontrou_pagina / len(casos), 4),
        "latencia_p50_ms": round(ordenados[len(ordenados) // 2], 1),
        "latencia_p95_ms": round(ordenados[int(0.95 * (len(ordenados) - 1))], 1),
        "por_limiar": {
            str(limiar): {
                "sinalizou_alvo": sinais[limiar],
                "taxa_sinalizacao": round(sinais[limiar] / len(casos), 4),
                "cartao_correto": corretos[limiar],
                "recall_cartao": round(corretos[limiar] / len(casos), 4),
                "cartao_incorreto": incorretos[limiar],
                "precisao_cartao": round(corretos[limiar] / (corretos[limiar] + incorretos[limiar]), 4)
                if corretos[limiar] + incorretos[limiar]
                else 0.0,
            }
            for limiar in LIMIARES
        },
    }
    SAIDA.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resultado, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
