"""Extrai trechos candidatos a gerar falas positivas, por corpus, para data/<corpus>/trechos_fonte.jsonl."""

from __future__ import annotations

import json
import logging
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)

from copiloto import parse  # noqa: E402
from copiloto.esquema import DIR_DADOS, DIR_PDFS  # noqa: E402

POR_PDF = 30
REFERENCIA = re.compile(r"(et al\.|doi|https?://|\(\d{4}\)|\d{4};\s*\d+|vol\.|pp\.|ISSN|Rev\.|J\.\s)", re.I)


def clinico(texto: str) -> bool:
    if not 280 <= len(texto) <= 1200:
        return False
    if len(REFERENCIA.findall(texto)) >= 2:
        return False
    digitos = sum(c.isdigit() for c in texto) / len(texto)
    return digitos < 0.05


def main() -> None:
    manifesto = json.loads((DIR_PDFS / "manifesto.json").read_text(encoding="utf-8"))
    aleatorio = random.Random(7)
    saida = DIR_DADOS / "trechos_fonte.jsonl"
    total = 0
    with saida.open("w", encoding="utf-8") as arquivo:
        for item in manifesto:
            caminho = DIR_PDFS / item["arquivo"]
            if not caminho.exists():
                continue
            blocos, _ = parse.extrair(caminho)
            bons = [b for b in blocos if clinico(b.texto)]
            aleatorio.shuffle(bons)
            for bloco in sorted(bons[:POR_PDF], key=lambda b: (b.pagina, b.paragrafo)):
                arquivo.write(json.dumps({
                    "arquivo": item["arquivo"], "titulo": item["titulo"], "idioma": item["idioma"],
                    "pagina": bloco.pagina, "paragrafo": bloco.paragrafo, "texto": bloco.texto,
                }, ensure_ascii=False) + "\n")
                total += 1
            print(f"  {item['arquivo'][:50]:<50} {len(bons):>4} clinicos, {min(len(bons), POR_PDF)} escritos")
    print(f"{saida}: {total} trechos")


if __name__ == "__main__":
    main()
