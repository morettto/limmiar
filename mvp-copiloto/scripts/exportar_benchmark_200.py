from __future__ import annotations

import json
import os
from pathlib import Path

os.environ.setdefault("COPILOTO_CORPUS", "teste")

RAIZ = Path(__file__).resolve().parents[1]
CASOS = RAIZ / "data" / "avaliacao" / "benchmark_200.jsonl"
SAIDA = RAIZ / "resultados" / "benchmark_200_lista.md"


def main() -> None:
    import sys

    sys.path.insert(0, str(RAIZ / "src"))
    from copiloto.esquema import conectar

    con = conectar()
    obras = {
        linha["arquivo"]: dict(linha)
        for linha in con.execute("select arquivo, titulo, autor, idioma from obra")
    }
    casos = [json.loads(linha) for linha in CASOS.read_text(encoding="utf-8").splitlines() if linha]
    partes = [
        "# Benchmark de 200 correspondências",
        "",
        "Cada item é uma fala positiva de teste, com contexto opcional e a correspondência bibliográfica esperada.",
        "A correspondência aceita qualquer página listada em `alvos`; `fonte` identifica o parágrafo de origem.",
        "",
    ]
    for numero, caso in enumerate(casos, 1):
        fonte = caso.get("fonte")
        arquivos = []
        for alvo in caso["alvos"]:
            arquivo = alvo["arquivo"]
            if arquivo in arquivos:
                continue
            arquivos.append(arquivo)
            obra = obras.get(arquivo, {})
            paginas = [str(item["pagina"]) for item in caso["alvos"] if item["arquivo"] == arquivo]
            partes.append(f"## {numero:03d}. {caso['id']} — {caso['idioma']}")
            partes.append(f"**Fenómeno:** {caso.get('fenomeno', '')}")
            partes.append(f"**Fala:** {caso['fala']}")
            contexto = caso.get("contexto") or []
            partes.append(f"**Contexto:** {' / '.join(contexto) if contexto else '(nenhum)'}")
            partes.append(
                f"**Esperado:** {obra.get('titulo', arquivo)} — {obra.get('autor', '')}; "
                f"páginas {', '.join(paginas)}."
            )
            if fonte:
                partes.append(f"**Fonte exata:** página {fonte['pagina']}, parágrafo {fonte['paragrafo']}.")
            partes.append("")
    SAIDA.write_text("\n".join(partes), encoding="utf-8")
    print(SAIDA)


if __name__ == "__main__":
    main()
