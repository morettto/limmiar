"""Baixa PDFs de acesso aberto de psicologia via OpenAlex, nos tres idiomas."""

from __future__ import annotations

import io
import json
import re
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import hashlib  # noqa: E402
import os  # noqa: E402

from copiloto.esquema import CORPUS, RAIZ  # noqa: E402
from copiloto.esquema import DIR_PDFS as _DIR_CORPUS  # noqa: E402

RODADA = os.environ.get("COPILOTO_BAIXAR_RODADA", "")
DIR_PDFS = RAIZ / "data" / f"pdfs-{RODADA}" if RODADA else _DIR_CORPUS

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://api.openalex.org/works"
CONTATO = "robertolegariofilho@gmail.com"
MANIFESTO = DIR_PDFS / "manifesto.json"

DOMINIOS_BLOQUEADOS = (
    "onlinelibrary.wiley.com",
    "sciencedirect.com",
    "link.springer.com",
    "tandfonline.com",
    "journals.sagepub.com",
    "academic.oup.com",
    "nature.com",
    "cambridge.org",
)

CONSULTAS_TESTE = {
    "pt-BR": [
        "ideacao suicida adolescentes fatores de risco",
        "luto complicado perda familiar",
        "transtorno obsessivo compulsivo tratamento",
        "burnout esgotamento profissional saude mental",
        "dissociacao trauma infancia",
        "uso de alcool dependencia",
    ],
    "es": [
        "ideacion suicida jovenes factores de riesgo",
        "duelo complicado perdida",
        "trastorno obsesivo compulsivo tratamiento",
        "burnout desgaste profesional salud mental",
        "disociacion trauma",
        "consumo de alcohol dependencia",
    ],
    "en-US": [
        "suicidal ideation risk factors young adults",
        "prolonged grief disorder",
        "obsessive compulsive disorder treatment",
        "burnout mental health workers",
        "dissociation childhood trauma",
        "alcohol use disorder treatment",
    ],
}

CONSULTAS = {
    "pt-BR": [
        "psicologia clinica ansiedade transtorno",
        "psicoterapia trauma sofrimento psiquico",
        "depressao terapia cognitivo comportamental",
    ],
    "es": [
        "psicologia clinica ansiedad trastorno",
        "psicoterapia trauma sufrimiento psiquico",
        "depresion terapia cognitivo conductual",
    ],
    "en-US": [
        "clinical psychology anxiety disorder",
        "psychotherapy trauma avoidance",
        "depression cognitive behavioral therapy",
    ],
}

CONSULTAS_RODADA = {
    "r3": {
        "pt-BR": ["luto viuvez idosos", "luto divorcio separacao conjugal", "luto perda dos pais", "comportamento suicida autolesao",
                  "sindrome de burnout profissionais", "uso abusivo de alcool", "discriminacao pessoas trans saude mental"],
        "es": ["duelo viudez", "duelo por divorcio", "autolesion adolescentes", "ideacion suicida", "sindrome de burnout docentes",
               "consumo problematico de alcohol"],
        "en-US": ["widowhood bereavement", "grief after divorce", "parental death bereavement", "non-suicidal self-injury",
                  "suicidal ideation", "burnout nurses", "alcohol use disorder", "transgender discrimination mental health"],
    },
    "r5": {
        "pt-BR": ["pesadelos estresse pos-traumatico", "evitacao experiencial ansiedade", "fissura alcool recaida", "despersonalizacao burnout",
                  "anedonia desesperanca depressao", "solidao idosos saude mental", "ataque de panico vivencia", "violencia por parceiro intimo mulheres",
                  "insonia sofrimento", "transtornos alimentares vivencia", "ansiedade social timidez", "autolesao nao suicida"],
        "es": ["pesadillas trastorno de estres postraumatico", "craving alcohol recaida", "despersonalizacion agotamiento", "soledad salud mental",
               "trastorno de panico experiencia", "violencia de pareja salud mental", "preocupacion ansiedad generalizada",
               "trastorno obsesivo compulsivo vivencia", "anhedonia depresion", "psicosis primer episodio experiencia"],
        "en-US": ["nightmares posttraumatic stress disorder", "intrusive memories trauma", "alcohol craving concealment",
                  "burnout depersonalization emotional exhaustion", "hopelessness anhedonia depression", "loneliness mental health",
                  "panic attacks lived experience", "generalized anxiety worry", "insomnia distress", "social anxiety disorder",
                  "intimate partner violence mental health", "eating disorders lived experience", "psychosis early signs",
                  "obsessive compulsive disorder symptoms"],
    },
}
LICENCAS_OK = {"cc-by", "cc-by-sa", "cc0", "public-domain"}

CODIGO_OPENALEX = {"pt-BR": "pt", "es": "es", "en-US": "en"}
MIN_BYTES = 40_000
MIN_CARACTERES = 4_000


def limpar(texto: str) -> str:
    return re.sub(r"\s+", " ", texto or "").strip()


def nome_arquivo(idioma: str, indice: int, titulo: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", limpar(titulo).lower())[:48].strip("-")
    return f"{idioma.lower()}-{indice:02d}-{base or 'obra'}.pdf"


def primeiro_autor(trabalho: dict) -> str:
    for autoria in trabalho.get("authorships", []):
        nome = (autoria.get("author") or {}).get("display_name")
        if nome:
            return nome
    return "desconhecido"


def candidatos(cliente: httpx.Client, idioma: str, quantos: int) -> list[dict]:
    consultas = CONSULTAS_RODADA[RODADA][idioma] if RODADA else (CONSULTAS_TESTE if CORPUS == "teste" else CONSULTAS)[idioma]
    por_consulta = max(5, -(-quantos * 4 // len(consultas)))
    grupos: list[list[dict]] = []
    vistos: set[str] = set()
    for consulta in consultas:
        achados: list[dict] = []
        grupos.append(achados)
        parametros = {
            "filter": f"is_oa:true,language:{CODIGO_OPENALEX[idioma]},type:article",
            "search": consulta,
            "per_page": "25",
            "mailto": CONTATO,
        }
        try:
            resposta = cliente.get(API, params=parametros, timeout=45)
            resposta.raise_for_status()
        except Exception as erro:
            print(f"  ! OpenAlex falhou ({consulta}): {erro}")
            continue
        for trabalho in resposta.json().get("results", []):
            locais = [local or {} for local in [trabalho.get("best_oa_location"), *trabalho.get("locations", [])]]
            if RODADA == "r5":
                locais = [local for local in locais if local.get("license") in LICENCAS_OK]
            urls = [local.get("pdf_url") for local in locais]
            url = next(
                (
                    u
                    for u in urls
                    if u and u not in vistos and not any(d in u for d in DOMINIOS_BLOQUEADOS)
                ),
                None,
            )
            if not url or len(achados) >= por_consulta:
                continue
            vistos.add(url)
            achados.append(
                {
                    "url": url,
                    "titulo": limpar(trabalho.get("display_name") or "sem titulo")[:160],
                    "autor": primeiro_autor(trabalho),
                    "ano": trabalho.get("publication_year"),
                    "idioma": idioma,
                    "licenca": next((local.get("license") for local in locais if local.get("pdf_url") == url), None),
                }
            )
        time.sleep(0.4)
    return [item for rodada in zip(*[g + [None] * (por_consulta - len(g)) for g in grupos]) for item in rodada if item]


def utilizavel(conteudo: bytes) -> tuple[bool, str, int]:
    if len(conteudo) < MIN_BYTES:
        return False, f"pequeno demais ({len(conteudo)} bytes)", 0
    if not conteudo.startswith(b"%PDF"):
        return False, "nao e PDF", 0
    try:
        from pypdf import PdfReader

        leitor = PdfReader(io.BytesIO(conteudo))
        texto = ""
        for pagina in leitor.pages[:12]:
            texto += pagina.extract_text() or ""
        if len(texto) < MIN_CARACTERES:
            return False, f"pouco texto extraivel ({len(texto)} chars)", len(leitor.pages)
        return True, "ok", len(leitor.pages)
    except Exception as erro:
        return False, f"pypdf falhou: {erro}", 0


def _titulo(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", limpar(t).lower())[:80]


def ja_usados() -> tuple[set[str], set[str], set[str]]:
    usados: set[str] = set()
    titulos: set[str] = set()
    for manifesto in RAIZ.glob("data/**/manifesto.json"):
        if manifesto.resolve() != MANIFESTO.resolve():
            itens = json.loads(manifesto.read_text(encoding="utf-8"))
            usados |= {item["url"] for item in itens}
            titulos |= {_titulo(item["titulo"]) for item in itens}
    hashes = {hashlib.sha256(p.read_bytes()).hexdigest() for p in RAIZ.glob("data/**/*.pdf") if p.parent.resolve() != DIR_PDFS.resolve()}
    return usados, titulos, hashes


def baixar(por_idioma: int = 4) -> list[dict]:
    DIR_PDFS.mkdir(parents=True, exist_ok=True)
    manifesto: list[dict] = []
    usados, titulos, hashes = ja_usados()
    cabecalhos = {"User-Agent": f"limmiar-mvp/0.1 (mailto:{CONTATO})"}
    with httpx.Client(follow_redirects=True, headers=cabecalhos) as cliente:
        for idioma in CONSULTAS:
            print(f"\n== {idioma} ==")
            aceites = 0
            for item in candidatos(cliente, idioma, por_idioma):
                if aceites >= por_idioma:
                    break
                if item["url"] in usados or _titulo(item["titulo"]) in titulos:
                    continue
                try:
                    resposta = cliente.get(item["url"], timeout=90)
                    resposta.raise_for_status()
                    conteudo = resposta.content
                except Exception as erro:
                    print(f"  x {item['titulo'][:50]}: download falhou ({type(erro).__name__})")
                    continue
                if hashlib.sha256(conteudo).hexdigest() in hashes:
                    print(f"  x {item['titulo'][:50]}: mesmo ficheiro de um corpus existente")
                    continue
                titulos.add(_titulo(item["titulo"]))
                ok, motivo, paginas = utilizavel(conteudo)
                if not ok:
                    print(f"  x {item['titulo'][:50]}: {motivo}")
                    continue
                arquivo = (f"{RODADA}-" if RODADA else "") + nome_arquivo(idioma, aceites + 1, item["titulo"])
                (DIR_PDFS / arquivo).write_bytes(conteudo)
                item["arquivo"] = arquivo
                item["paginas"] = paginas
                item["bytes"] = len(conteudo)
                manifesto.append(item)
                aceites += 1
                print(f"  + {arquivo}  ({paginas} pag, {len(conteudo)//1024} KB)")
            if aceites < por_idioma:
                print(f"  aviso: so {aceites} de {por_idioma} para {idioma}")
    MANIFESTO.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nmanifesto: {MANIFESTO}  ({len(manifesto)} PDFs)")
    return manifesto


if __name__ == "__main__":
    quantidade = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    baixar(quantidade)
