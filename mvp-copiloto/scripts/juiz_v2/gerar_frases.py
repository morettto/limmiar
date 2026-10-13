"""Gera ~5 mil falas sintéticas de paciente para qualificar o fluxo no acervo de teste.
Uso: gerar_frases.py MODELO SAIDA.jsonl [N_TRECHOS]

Positivas: 3 falas por trecho, escritas sem vocabulário técnico a partir da experiência que o trecho descreve (a fonte é o gabarito).
Negativas: neutras, expressões figuradas, falas do terapeuta e falas ambíguas.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import sqlite3
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(RAIZ / "src")]
from copiloto.trecho import prosa

IDIOMAS = {"pt-BR": "Brazilian Portuguese", "en-US": "American English", "es": "Latin American Spanish"}
PESOS = [("pt-BR", .6), ("en-US", .2), ("es", .2)]
TOPICOS = ["family dinner", "work deadlines", "sleep", "a new relationship", "money", "the neighbourhood", "health exams", "school",
           "a friend's wedding", "the weekend", "moving house", "the commute", "social media", "a pet", "an old injury", "religion",
           "parenting", "retirement", "a medication", "the news", "exercise", "food", "travel plans", "a breakup", "the therapist's schedule"]
NEGATIVOS = {
    "neutro": (800, "Write {n} different things a patient might say during a therapy session that have NO clinical meaning: small talk, logistics, "
                    "neutral facts about the week, mild passing feelings, good news. Topic: {topico}."),
    "quase": (600, "Write {n} different statements by a patient that use strong or dramatic idioms which sound alarming but are only figures of speech about "
                   "everyday things (like 'I'm dying of laughter', 'this heat is killing me', 'morrendo de vergonha', 'me muero de hambre'), with no real distress. Topic: {topico}."),
    "terapeuta": (300, "Write {n} different things a THERAPIST says to a patient in session (reflections, questions, summaries), related to {topico}."),
    "ambiguo": (300, "Write {n} different short statements by a patient that could be a figure of speech OR a veiled wish to disappear or to die "
                     "(like 'sometimes I wish I could just vanish'), where only a clarifying question could tell which. Topic: {topico}."),
}
POSITIVO = ("Below is a passage from a scientific text. Write 3 different statements that a patient could say in psychotherapy, in first person, in colloquial "
            "{idioma}, 1 or 2 sentences each, expressing the experience the passage describes as the patient lives it. Do NOT use technical or clinical "
            "vocabulary and do NOT copy words from the passage. Output exactly 3 lines, each starting with '- '.\n\nPASSAGE:\n{trecho}")


def idioma_de(chave: str) -> str:
    x = int(hashlib.sha256(chave.encode()).hexdigest(), 16) % 100 / 100
    acum = 0.0
    for nome, peso in PESOS:
        acum += peso
        if x < acum:
            return nome
    return PESOS[-1][0]


def linhas(texto: str) -> list[str]:
    saida = []
    for linha in texto.splitlines():
        linha = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", linha).strip().strip('"“”')
        if 20 <= len(linha) <= 320:
            saida.append(linha)
    return saida


def main() -> None:
    from vllm import LLM, SamplingParams

    modelo, saida = sys.argv[1], Path(sys.argv[2])
    n_trechos = int(sys.argv[3]) if len(sys.argv) > 3 else 1100
    con = sqlite3.connect(f"file:{RAIZ / 'data' / 'teste' / 'acervo.db'}?mode=ro", uri=True)
    trechos = [r for r in con.execute("select o.arquivo, t.pagina, t.paragrafo, t.id, t.texto from trecho t join obra o on o.id = t.obra_id") if prosa(r[4])]
    azar = random.Random(7)
    azar.shuffle(trechos)
    trechos = trechos[:n_trechos]
    pedidos, meta = [], []
    for arq, pag, par, tid, texto in trechos:
        idioma = idioma_de(tid)
        pedidos.append(POSITIVO.format(idioma=IDIOMAS[idioma], trecho=" ".join(texto.split())[:1500]))
        meta.append(("positivo", idioma, {"arquivo": arq, "pagina": pag, "paragrafo": par, "trecho_id": tid}))
    for tipo, (alvo, modelo_prompt) in NEGATIVOS.items():
        for _ in range(int(alvo / 8 * 1.35)):
            idioma = azar.choices([p[0] for p in PESOS], [p[1] for p in PESOS])[0]
            pedidos.append(modelo_prompt.format(n=10, topico=azar.choice(TOPICOS)) + f" Write them in colloquial {IDIOMAS[idioma]}. Output only the 10 lines, each starting with '- '.")
            meta.append((tipo, idioma, None))
    llm = LLM(model=modelo, max_model_len=3072, gpu_memory_utilization=0.9, enable_prefix_caching=True, trust_remote_code=True)
    resp = llm.chat([[{"role": "user", "content": p}] for p in pedidos], SamplingParams(max_tokens=420, temperature=0.9, top_p=0.95),
                    chat_template_kwargs={"enable_thinking": False})
    vistos, contagem, escritas = set(), {}, []
    for (tipo, idioma, fonte), r in zip(meta, resp, strict=True):
        for fala in linhas(r.outputs[0].text)[:3 if tipo == "positivo" else 10]:
            if fala.lower() in vistos or contagem.get(tipo, 0) >= (3300 if tipo == "positivo" else NEGATIVOS[tipo][0]):
                continue
            vistos.add(fala.lower())
            contagem[tipo] = contagem.get(tipo, 0) + 1
            escritas.append({"id": f"q5k-{tipo}-{contagem[tipo]:04d}", "fala": fala, "contexto": [], "falante": "terapeuta" if tipo == "terapeuta" else "paciente",
                             "idioma": idioma, "tipo": tipo, "fonte": fonte})
    saida.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in escritas), encoding="utf-8")
    print(contagem, "total", len(escritas), flush=True)


if __name__ == "__main__":
    main()
