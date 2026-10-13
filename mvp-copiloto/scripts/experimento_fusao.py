"""Testa pesos de fusao por embedder, com cache dos embeddings em resultados/cache."""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import avaliacao, embedder, hibrido, traducao  # noqa: E402
from copiloto.esquema import conectar  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
CACHE = RAIZ / "resultados" / "cache"
SONDAS = json.loads((RAIZ / "data" / "probes.json").read_text(encoding="utf-8"))["sondas"]
MODELOS = sys.argv[1:] or ["ibm-granite/granite-embedding-278m-multilingual", "Qwen/Qwen3-Embedding-0.6B"]

ARRANJOS = {
    "denso so": (1, "nenhum"),
    "denso + bm25 original": (1, "original"),
    "denso + bm25 3 idiomas": (1, "todos"),
    "2x denso + bm25 3 idiomas": (2, "todos"),
    "3x denso + bm25 3 idiomas": (3, "todos"),
    "2x denso + bm25 original": (2, "original"),
}


def matriz_em_cache(modelo: str, textos: list[str]) -> np.ndarray:
    CACHE.mkdir(parents=True, exist_ok=True)
    arquivo = CACHE / (modelo.replace("/", "__") + f"__{len(textos)}.npy")
    if arquivo.exists():
        return np.load(arquivo)
    inicio = time.perf_counter()
    matriz = embedder.codificar_documentos(textos, modelo, lote=16)
    np.save(arquivo, matriz)
    print(f"  indexou em {time.perf_counter() - inicio:.0f}s", flush=True)
    return matriz


def main() -> None:
    con = conectar()
    trechos = [
        dict(r)
        for r in con.execute(
            "select t.id, t.obra_id, t.texto, t.idioma, t.avaliacao, o.arquivo from trecho t"
            " join obra o on o.id = t.obra_id where o.status='pronto' order by t.rowid"
        )
    ]
    textos = [t["texto"] for t in trechos]
    ids = [t["id"] for t in trechos]
    arquivos = [t["arquivo"] for t in trechos]
    lexical = hibrido.IndiceLexical(textos)
    consultas = avaliacao.gerar_consultas([t for t in trechos if t["avaliacao"] == 1], seed=42)
    traducao.aquecer()
    variantes = {s["frase"]: list(dict.fromkeys(traducao.variantes(s["frase"], s["idioma"]).values())) for s in SONDAS}

    def listas_lexicais(frase: str, modo: str, todas: list[str]) -> list[list[int]]:
        if modo == "nenhum":
            return []
        alvo = [frase] if modo == "original" else todas
        return [lexical.ordenar(t, 30) for t in alvo]

    resumo = []
    for modelo in MODELOS:
        print(f"\n--- {modelo} ---", flush=True)
        matriz = matriz_em_cache(modelo, textos)

        def denso(v: np.ndarray) -> list[int]:
            s = matriz @ v
            topo = np.argpartition(-s, 29)[:30]
            return topo[np.argsort(-s[topo])].tolist()

        vc = embedder.codificar_consultas([c["consulta"] for c in consultas], modelo, lote=16)
        vs = embedder.codificar_consultas([s["frase"] for s in SONDAS], modelo, lote=16)
        for nome, (peso, modo) in ARRANJOS.items():
            posicoes = []
            for v, c in zip(vc, consultas):
                listas = [denso(v)] * peso + listas_lexicais(c["consulta"], modo, [c["consulta"]])
                ordem = hibrido.fundir_rrf(*listas, k=10)
                posicoes.append(avaliacao.posicao_do_alvo([ids[i] for i in ordem], c["trecho_id"]))
            m = avaliacao.metricas(posicoes)
            acertos = 0
            for v, s in zip(vs, SONDAS):
                listas = [denso(v)] * peso + listas_lexicais(s["frase"], modo, variantes[s["frase"]])
                topo = [arquivos[i] for i in hibrido.fundir_rrf(*listas, k=3)]
                acertos += any(a.startswith(p) for a in topo for p in s["esperado"])
            linha = {"modelo": modelo.split("/")[-1], "arranjo": nome, "R@1": m["recall_em_1"],
                     "R@5": m["recall_em_5"], "MRR": m["mrr_em_10"], "sondas": acertos}
            resumo.append(linha)
            print(f"  {nome:28} R@1 {m['recall_em_1']:.3f}  R@5 {m['recall_em_5']:.3f}  MRR {m['mrr_em_10']:.3f}  sondas {acertos}/12", flush=True)

    (RAIZ / "resultados" / "fusao.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
