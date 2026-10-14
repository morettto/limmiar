"""Contrastes sintéticos de sujeito e referência, derivados somente das âncoras de dev."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from copiloto import busca
from copiloto.treinado import consulta

MOLDES = {
    "pt-BR": ("Isso continua acontecendo comigo e é o que preciso discutir hoje.",
              "A fala anterior era uma citação de outra pessoa, não a descrição de algo que eu vivo.",
              "É ela quem vive isso; eu só estava reproduzindo o relato dela."),
    "es": ("Eso sigue pasándome y es lo que necesito hablar hoy.",
           "La frase anterior era una cita de otra persona, no la descripción de algo que yo vivo.",
           "Es ella quien vive eso; yo solo estaba reproduciendo su relato."),
    "en-US": ("That keeps happening to me and is what I need to discuss today.",
              "The previous statement was a quotation from someone else, not a description of my own experience.",
              "She is the one experiencing that; I was only quoting her account."),
}


def gerar() -> list[dict]:
    fontes = {(p["arquivo"], p["pagina"], p["paragrafo"]): p["texto"] for p in
              map(json.loads, (RAIZ / "data/trechos_fonte.jsonl").read_text(encoding="utf-8").splitlines())}
    saida = []
    for c in map(json.loads, (RAIZ / "data/avaliacao/dev_positivos.jsonl").read_text(encoding="utf-8").splitlines()):
        f = c["fonte"]
        texto = fontes[(f["arquivo"], f["pagina"], f["paragrafo"])]
        if not busca._proveniencia_ok(f["arquivo"], f["pagina"], texto):
            raise ValueError(f"Âncora de desenvolvimento sem proveniência: {c['id']}")
        elipse, citacao, terceiro = MOLDES[c["idioma"]]
        original = consulta(c["fala"], c["contexto"])
        grupo = c["id"]
        for variante, fala, contexto, valido, justificativa in (
            ("direta", c["fala"], c["contexto"], True, c["justificativa"]),
            ("elipse", elipse, [original], True, "A fala atual confirma a experiência própria descrita na âncora de dev."),
            ("citacao", citacao, [original], False, "O paciente esclarece que estava citando outra pessoa e nega ser sua experiência."),
            ("terceiro", terceiro, [original, citacao], False, "O contexto e a fala atual atribuem a experiência a uma terceira pessoa."),
        ):
            saida.append({"id": f"ctx-{grupo}-{variante}", "grupo": grupo, "fala": fala, "contexto": contexto,
                          "idioma": c["idioma"], **f, "trecho": texto, "valido": valido,
                          "justificativa": justificativa, "origem": "contraste-sintetico-dev",
                          "trecho_sha256": hashlib.sha256(texto.encode()).hexdigest()})
    return saida


if __name__ == "__main__":
    linhas = gerar()
    destino = RAIZ / "data/treino/contexto-dev.jsonl"
    destino.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in linhas), encoding="utf-8")
    print(f"{len(linhas)} contrastes de dev; nenhum arquivo de teste ou final foi lido.")
