"""Build a fresh, source-grounded multilingual acceptance set; verify PDF quotes."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
CONCEPTS = [
    ("anedonia", "edd14123", "anhedonia (significant  loss of interest or pleasure in activities)", [
        "Há mais de um mês nem brincar com meu cachorro nem ouvir minhas músicas me dá qualquer prazer.",
        "Desde hace varias semanas no disfruto ni pintar ni estar con mis amigos; todo me da igual.",
        "For weeks even gardening and seeing my children have brought me no enjoyment at all."]),
    ("desvalia", "654ef276", "feelings  of worthlessness and difficulty concentrating", [
        "Passo os dias me sentindo sem valor e não consigo manter a atenção nem numa conversa curta.",
        "Me siento inútil casi todos los días y pierdo el hilo de cualquier conversación.",
        "Most days I feel worthless and cannot concentrate long enough to read a single page."]),
    ("sobrecarga_cuidado", "2913005f", "tempo utilizado para a assistência, redução das relações sociais e do tempo livre, dificuldade econômica", [
        "Cuidar da minha mãe com transtorno mental ocupa meu dia inteiro; perdi meus amigos e estou endividada.",
        "Atender a mi hermano con enfermedad mental me dejó sin tiempo libre, sin amigos y sin dinero.",
        "Caring for my father with mental illness takes all my time, and I have stopped seeing friends and run out of money."]),
    ("culpa_trauma", "8bce76bc", "because I didn’t fight harder, it is my fault I was assaulted", [
        "Depois daquela agressão fico me acusando: se eu tivesse resistido mais, nada disso teria acontecido.",
        "Desde la agresión pienso que todo fue culpa mía por no haberme defendido con más fuerza.",
        "I keep blaming myself for the assault because I did not fight back hard enough."]),
    ("intrusoes_trauma", "8ed80fe8", "involuntary reexperiencing of the trauma", [
        "As imagens do acidente invadem minha cabeça sem eu querer, como se tudo estivesse acontecendo de novo.",
        "Sin querer me vuelven las imágenes del asalto y siento que estoy viviendo aquello otra vez.",
        "Images of the assault burst into my mind without warning, and it feels as if it is happening again."]),
    ("autolesao_sem_suicidio", "f29b655c", "daño de  tejido corporal deliberado, autoinﬂinjido, sin intención suicida", [
        "Eu faço cortes na pele de propósito, mas não quero acabar com a minha vida.",
        "Me quemo la piel a propósito; no lo hago para morir ni para intentar suicidarme.",
        "I deliberately scratch myself until I bleed, but I have no intention of ending my life."]),
    ("autolesao_alivio", "a5807067", "la tensión psicológica disminuye aliviando a la persona", [
        "A aflição vai crescendo até eu me cortar; depois do corte a tensão baixa por um tempo.",
        "El malestar sube hasta que me hago daño y entonces noto un alivio breve de la tensión.",
        "The distress builds until I injure myself, and afterward the tension eases for a little while."]),
    ("autolesao_impulsiva", "4c117301", "forte impulsividade, que transbordava em comportamentos autolesivos, principalmente ao se cortar", [
        "Quando me frustram eu me corto sem pensar; o impulso vem tão rápido que só percebo depois.",
        "Cuando algo me frustra me corto de manera impulsiva, sin detenerme a pensar antes.",
        "When I feel frustrated I cut myself on impulse before I have time to think."]),
    ("desconfianca_terapeuta", "8062cb5c", "o terapeuta não se preocupava com ela, não respondia às suas perguntas", [
        "Sinto que você não liga para mim, evita minhas perguntas e não quer cuidar do que estou vivendo.",
        "Siento que a usted no le importo, que no responde mis preguntas ni quiere ayudarme.",
        "I feel that you do not care about me and do not answer my questions or want to help me."]),
    ("purgacao", "0f653424", "recorrência de vômitos logo após as refeições e uso abusivo de laxantes", [
        "Depois das refeições provoco vômito e tomo laxantes em excesso para tentar emagrecer.",
        "Después de comer me provoco el vómito y tomo demasiados laxantes para bajar de peso.",
        "After meals I make myself vomit and take excessive laxatives because I am trying to lose weight."]),
    ("burnout_empatia", "6ef0c5ea", "falta de interés, pérdida de empatía e insensibilidad hacia  los receptores del servicio", [
        "O trabalho me esgotou tanto que trato meus alunos com frieza e não consigo mais sentir empatia.",
        "El trabajo me ha agotado y ahora trato a mis alumnos con frialdad, sin sentir empatía.",
        "Work has worn me down so much that I now treat my students coldly and feel no empathy for them."]),
    ("burnout_fracasso", "eb40311c", "sensación de fracaso y baja autoestima e insatisfacción  con sus resultados profesionales", [
        "No trabalho sinto que não alcanço mais nada, fracassei como profissional e meus resultados nunca me satisfazem.",
        "Siento que he fracasado profesionalmente; no logro nada en el trabajo y mis resultados me decepcionan.",
        "At work I feel like a professional failure; I cannot accomplish anything and am dissatisfied with my results."]),
    ("alexitimia", "3e051d77", "difficulty identifying and communicating feelings", [
        "Percebo alguma coisa no corpo, mas não consigo saber qual emoção é nem explicar o que sinto.",
        "Noto algo en el cuerpo pero no sé identificar qué emoción es ni decir cómo me siento.",
        "I notice something in my body but cannot identify which emotion it is or describe how I feel."]),
    ("agorafobia", "96e6d737", "lugares y  situaciones que pueden causar  pánicos o sentirte atrapado", [
        "Evito ônibus lotado e shopping porque tenho medo de entrar em pânico sem conseguir sair.",
        "Evito el metro lleno y los centros comerciales porque temo entrar en pánico y quedar atrapada.",
        "I avoid crowded buses and shopping malls because I fear panicking there without being able to escape."]),
    ("panico", "849f2d5e", "aparición repentina de miedo y una sensación de muerte  inminente", [
        "Sem aviso vem um terror enorme, meu coração dispara e eu sinto que vou morrer naquele instante.",
        "Sin aviso siento un terror repentino, el corazón se acelera y creo que voy a morir en ese momento.",
        "Without warning I feel overwhelming terror, my heart races, and I think I am about to die."]),
    ("luto_memoria", "618d26ab", "relatava mais perda de memória e mais problemas de concentração", [
        "Desde que fiquei viúva tenho esquecido compromissos e não consigo me concentrar como antes.",
        "Desde que murió mi esposo olvido las citas y tengo mucho más problema para concentrarme.",
        "Since my husband died I have been forgetting appointments and finding it much harder to concentrate."]),
    ("sonho_exames", "2a4dc7d3", "sonhos angustiantes de ter sido  reprovado, ou de ser obrigado a refazer o exame", [
        "Já terminei a faculdade há anos, mas sonho toda semana que fui reprovada e preciso fazer tudo de novo.",
        "Me gradué hace años pero sueño una y otra vez que suspendí el examen y tengo que repetirlo.",
        "I graduated years ago, but keep dreaming that I failed the final exam and must take it again."]),
    ("sonho_nudez", "147fca71", "sonhos de estar nu em que de fato se sente vergonha e embaraço", [
        "No sonho estou nua diante de desconhecidos, morro de vergonha e tento me esconder, mas não consigo sair.",
        "Sueño que estoy desnuda ante desconocidos, siento vergüenza y quiero esconderme pero no puedo moverme.",
        "In my recurring dream I am naked in front of strangers and too embarrassed to move away or hide."]),
    ("sonho_morte", "fa09615f", "o sonhador fica profundamente abalado com essa morte e pode até chorar  amargamente durante o sono", [
        "Sonhei de novo que minha irmã morreu e chorei dormindo; acordei abalada, embora ela esteja bem.",
        "Volví a soñar que moría mi madre y lloré dormida; desperté angustiada aunque ella está bien.",
        "I dreamed again that my brother died and cried in my sleep, although he is alive and well."]),
    ("solidao", "b72331c0", "painfully experienced absence of social contact, belongingness, or a sense of isolation", [
        "Mesmo cercada de pessoas me sinto dolorosamente sozinha, como se não pertencesse a lugar nenhum.",
        "Aunque estoy rodeada de gente siento una soledad dolorosa, como si no perteneciera a ningún sitio.",
        "Even around other people I feel painfully alone and as though I do not belong anywhere."]),
]

NEGATIVES = [
    ("neutro", "pt-BR", "Pode emitir o recibo da consulta de hoje?"),
    ("neutro", "pt-BR", "Meu trem atrasou e por isso cheguei cinco minutos depois."),
    ("neutro", "pt-BR", "A próxima sessão pode ser às três da tarde?"),
    ("neutro", "pt-BR", "Deixei a bicicleta na entrada do prédio."),
    ("neutro", "pt-BR", "Vou buscar minha filha na escola depois daqui."),
    ("neutro", "pt-BR", "Qual é a senha do wi-fi da recepção?"),
    ("neutro", "pt-BR", "Prefiro sentar nesta cadeira perto da janela."),
    ("neutro", "es", "¿Puede darme el comprobante de pago de la consulta?"),
    ("neutro", "es", "La próxima semana estaré de viaje y necesito cambiar la cita."),
    ("neutro", "es", "Dejé mi abrigo en la sala de espera."),
    ("neutro", "es", "¿A qué hora cierra el estacionamiento?"),
    ("neutro", "es", "Mi teléfono se quedó sin batería durante el trayecto."),
    ("neutro", "es", "Voy a almorzar con mi prima cuando termine la sesión."),
    ("neutro", "es", "El ascensor estaba ocupado y subí por la escalera."),
    ("neutro", "en-US", "Could you send me the receipt for today's appointment?"),
    ("neutro", "en-US", "I parked my bicycle outside the building."),
    ("neutro", "en-US", "Can we move next week's session to the afternoon?"),
    ("neutro", "en-US", "I bought vegetables on my way here."),
    ("neutro", "en-US", "Where can I refill my water bottle?"),
    ("neutro", "en-US", "My cousin is picking me up after the appointment."),
    ("ambiguo", "pt-BR", "Ultimamente tenho vontade de sumir, mas não sei explicar o que quero dizer."),
    ("ambiguo", "pt-BR", "Não aguento mais isso, queria que tudo parasse."),
    ("ambiguo", "pt-BR", "Está tudo estranho dentro de mim hoje."),
    ("ambiguo", "pt-BR", "Tem umas coisas que faço quando fico mal, mas ainda não quero contar."),
    ("ambiguo", "pt-BR", "Aconteceu aquilo outra vez, você sabe do que eu estou falando?"),
    ("ambiguo", "pt-BR", "Quando ela vai embora fico de um jeito que nem sei dizer."),
    ("ambiguo", "pt-BR", "Parece que perdi o controle, só não sei de quê."),
    ("ambiguo", "es", "A veces quiero desaparecer, pero no sé qué significa eso para mí."),
    ("ambiguo", "es", "No aguanto más y quisiera que todo se detuviera."),
    ("ambiguo", "es", "Me volvió a pasar aquello, pero todavía no puedo explicarlo."),
    ("ambiguo", "es", "Siento algo raro por dentro y no sé qué es."),
    ("ambiguo", "es", "A veces hago cosas cuando estoy mal, prefiero no decir cuáles."),
    ("ambiguo", "es", "Me quedo diferente cuando él se va, no sé describirlo."),
    ("ambiguo", "en-US", "Sometimes I want to disappear, but I cannot explain what I mean by that."),
    ("ambiguo", "en-US", "I cannot take this anymore; I wish everything would stop."),
    ("ambiguo", "en-US", "That thing happened again, but I am not ready to describe it."),
    ("ambiguo", "en-US", "There is something strange inside me today."),
    ("ambiguo", "en-US", "I do things when I feel bad, but I do not want to say what."),
    ("ambiguo", "en-US", "I feel different when she leaves, and cannot explain how."),
    ("ambiguo", "en-US", "I seem to have lost control, but I cannot say of what."),
]


def normalize(text: str) -> str:
    text = re.sub(r"-\s*\n\s*", "", text)
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def literal_pdf_quote(quote: str, page: str) -> str:
    target = normalize(quote)
    for start in range(len(page)):
        if page[start].isspace():
            continue
        if not target.startswith(unicodedata.normalize("NFKC", page[start])):
            continue
        for end in range(start + len(quote) // 2, min(len(page), start + len(quote) * 3) + 1):
            if normalize(page[start:end]) == target:
                return page[start:end]
    raise AssertionError((quote, "literal span missing"))


def main() -> None:
    connection = sqlite3.connect(f"file:{ROOT / 'data/acervo.db'}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    readers: dict[Path, PdfReader] = {}
    cases = []
    for concept, prefix, quote, statements in CONCEPTS:
        matches = connection.execute(
            "select t.*,o.titulo,o.autor,o.arquivo,o.arquivo_hash from trecho t "
            "join obra o on o.id=t.obra_id where t.id like ?", (prefix + "%",)
        ).fetchall()
        assert len(matches) == 1, prefix
        source = dict(matches[0])
        paths = [path for path in (ROOT / "data").rglob(source["arquivo"]) if path.suffix == ".pdf"]
        assert paths, source["arquivo"]
        pdf = paths[0]
        reader = readers.setdefault(pdf, PdfReader(pdf))
        page = reader.pages[source["pagina"] - 1].extract_text()
        normalized_quote = normalize(quote)
        assert normalized_quote in normalize(source["texto"]), (concept, "paragraph quote")
        assert normalized_quote in normalize(page), (concept, "PDF quote")
        literal = literal_pdf_quote(quote, page)
        evidence = {
            "trecho_id": source["id"], "arquivo": source["arquivo"],
            "obra": source["titulo"], "autor": source["autor"],
            "pagina_pdf": source["pagina"], "paragrafo_extraido": source["paragrafo"],
            "citacao_literal": literal, "texto_paragrafo": source["texto"],
            "sha256_pdf": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "citacao_verificada_pdf": True,
        }
        if "e2a73899" in source["obra_id"]:
            assert "Sigmund Freud" in page
            evidence["autor"] = "Sigmund Freud"
            evidence["nota_metadado"] = "Autor verificado no cabeçalho do PDF; SQLite diz desconhecido."
        for language, statement in zip(("pt-BR", "es", "en-US"), statements):
            cases.append({"id": f"final100-{len(cases)+1:03d}", "parte": "final",
                          "tipo": "positivo", "idioma": language, "fala": statement,
                          "contexto": [], "fenomeno": concept, "esperados": [source["id"]],
                          "evidencias": [evidence]})
    for kind, language, statement in NEGATIVES:
        cases.append({"id": f"final100-{len(cases)+1:03d}", "parte": "final", "tipo": kind,
                      "idioma": language, "fala": statement, "contexto": [],
                      "esperados": [], "evidencias": []})
    assert len(cases) == 100
    assert len({case["fala"] for case in cases}) == 100
    old = {json.loads(line)["fala"] for name in ("dev_positivos", "dev_negativos", "teste_positivos", "teste_negativos", "produto_ajuste", "produto_prova")
           for line in (ROOT / "data/avaliacao" / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()}
    assert not old.intersection(case["fala"] for case in cases)
    output = ROOT / "data/avaliacao/final100_verificado.jsonl"
    output.write_text("".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases), encoding="utf-8")
    print(json.dumps({"cases": len(cases), "positive": 60, "ambiguous": 20, "neutral": 20,
                      "verified_anchors": len(CONCEPTS), "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
