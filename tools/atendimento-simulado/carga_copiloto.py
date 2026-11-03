"""Teste de carga ponta a ponta do copiloto: sessões simuladas em tempo real, várias ao mesmo tempo.

Cada profissional (um por tema) guarda no acervo as obras das suas sessões; cada sessão autoriza as 5 dela e manda cada
fala do paciente quando ela termina de ser dita (150 palavras por minuto, os primeiros --minutos do roteiro de
.local/simulacao-100/sessoes). A API do produto é simulada aqui: só a lista de materiais de cada conta. O copiloto
(copiloto.api:app) precisa estar no ar com COPILOTO_API_URL apontando para --porta-api.
Grava em .local/simulacao-laya/RUN/: preparo.jsonl, respostas.jsonl, recursos.jsonl e resumo.json.

A mesma porta serve uma página ao vivo (http://127.0.0.1:5260/) com as falas e os cartões de cada sessão.

Uso: carga_copiloto.py RUN [--simultaneas 8] [--minutos 6] [--sessoes 100 | --ids 001-trauma 051-luto] [--copiloto URL]
[--porta-api 5260]
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import statistics
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import psutil

RAIZ = Path(__file__).resolve().parents[2]
SESSOES = RAIZ / ".local/simulacao-100/sessoes"
PALAVRAS_POR_SEGUNDO = 2.5
CABECALHO = {"Authorization": "Bearer teste-de-carga"}
MATERIAIS: dict[str, list[str]] = {}
EVENTOS: list[dict] = []
TRAVA_EVENTOS = threading.Lock()
PAGINA = (Path(__file__).parent / "carga_ao_vivo.html").read_text(encoding="utf-8")


def evento(**dados) -> None:
    with TRAVA_EVENTOS:
        EVENTOS.append({"t": round(time.time(), 2), **dados})


class ApiFalsa(BaseHTTPRequestHandler):
    def _responder(self, status: int, tipo: str, corpo: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.end_headers()
        self.wfile.write(corpo.encode())

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._responder(200, "text/html; charset=utf-8", PAGINA)
        if self.path.startswith("/eventos"):
            desde = int(self.path.partition("desde=")[2] or 0)
            with TRAVA_EVENTOS:
                novos = EVENTOS[desde:]
            return self._responder(200, "application/json", json.dumps(novos, ensure_ascii=False))
        conta = self.path.split("/")[2] if self.path.startswith("/accounts/") else ""
        corpo = json.dumps({"materials": [{"materialId": m, "authorized": True} for m in MATERIAIS.get(conta, [])]})
        self._responder(200 if conta in MATERIAIS else 404, "application/json", corpo)

    def log_message(self, *_):
        pass


def conta(tema: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"limmiar-carga/{tema}"))


def material(conta_id: str, pmcid: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"limmiar-carga/{conta_id}/{pmcid}"))


def acervo_reduzido(roteiros: list[dict], por_tema: int) -> dict[str, set[str]]:
    """As `por_tema` obras mais usadas pelas sessões de cada tema."""
    uso: dict[str, dict[str, int]] = {}
    for r in roteiros:
        for f in r["sources"]:
            uso.setdefault(r["theme"], {}).setdefault(f["pmcid"], 0)
            uso[r["theme"]][f["pmcid"]] += 1
    return {tema: set(sorted(c, key=lambda p: (-c[p], p))[:por_tema]) for tema, c in uso.items()}


def carregar(n: int, minutos: float, ids: list[str] | None, por_tema: int | None) -> list[dict]:
    arquivos = sorted(SESSOES.glob("*/scenario.json"))
    arquivos = [a for a in arquivos if a.parent.name in ids] if ids else arquivos[:n]
    roteiros = [json.loads(a.read_text(encoding="utf-8")) for a in arquivos]
    reduzido = acervo_reduzido(roteiros, por_tema) if por_tema else None
    sessoes = []
    for roteiro in roteiros:
        if reduzido:
            # cada sessão fica com as obras dela que estão no acervo reduzido, ou com a mais usada do tema
            fontes = [f for f in roteiro["sources"] if f["pmcid"] in reduzido[roteiro["theme"]]]
            roteiro["sources"] = fontes or [next(f for r in roteiros if r["theme"] == roteiro["theme"]
                                                 for f in r["sources"] if f["pmcid"] in reduzido[roteiro["theme"]])]
        acc = conta(roteiro["theme"])
        relogio, turnos = 0.0, []
        for turno in roteiro["turns"]:
            relogio += len(turno["text"].split()) / PALAVRAS_POR_SEGUNDO
            if relogio > minutos * 60:
                break
            turnos.append((relogio, turno["role"], turno["text"]))
        sessoes.append({"id": roteiro["id"], "conta": acc, "fontes": roteiro["sources"], "turnos": turnos,
                        "falas": [(m, t) for m, papel, t in turnos if papel == "Paciente"],
                        "materiais": [material(acc, f["pmcid"]) for f in roteiro["sources"]]})
    return sessoes


async def preparar(cliente: httpx.AsyncClient, url: str, sessoes: list[dict], saida: Path) -> None:
    obras = {}
    for s in sessoes:
        for fonte, mat in zip(s["fontes"], s["materiais"]):
            obras[(s["conta"], mat)] = fonte
            MATERIAIS.setdefault(s["conta"], [])
            if mat not in MATERIAIS[s["conta"]]:
                MATERIAIS[s["conta"]].append(mat)
    vaga = asyncio.Semaphore(3)

    async def uma(acc: str, mat: str, fonte: dict, arq):
        dados = Path(fonte["path"]).read_bytes()
        campos = {"titulo": fonte["title"], "autores": "; ".join(fonte["authors"]), "tipo": "pdf",
                  "sha256": hashlib.sha256(dados).hexdigest()}
        async with vaga:
            inicio = time.perf_counter()
            while True:
                r = await cliente.post(f"{url}/api/acervo/{acc}/{mat}/preparar", headers=CABECALHO, data=campos,
                                       files={"file": (f"{fonte['pmcid']}.pdf", dados, "application/pdf")})
                if r.status_code != 429:
                    break
                await asyncio.sleep(2)
            while True:
                lista = (await cliente.get(f"{url}/api/acervo/{acc}", headers=CABECALHO)).json()["materials"]
                estado = next((m for m in lista if m["materialId"] == mat), {})
                if estado.get("ready") or estado.get("stage") == "falhou":
                    break
                await asyncio.sleep(1)
        linha = {"conta": acc, "material": mat, "pmcid": fonte["pmcid"], "ok": bool(estado.get("ready")),
                 "paragrafos": estado.get("paragraphs"), "segundos": round(time.perf_counter() - inicio, 1)}
        arq.write(json.dumps(linha) + "\n")
        arq.flush()
        evento(tipo="preparo", total=len(obras), titulo=fonte["title"], **linha)
        print(f"preparo {fonte['pmcid']}: {linha['segundos']} s, {linha['paragrafos']} parágrafos", flush=True)

    with open(saida / "preparo.jsonl", "w", encoding="utf-8") as arq:
        await asyncio.gather(*(uma(acc, mat, fonte, arq) for (acc, mat), fonte in obras.items()))


async def sessao(cliente: httpx.AsyncClient, url: str, s: dict, vaga: asyncio.Semaphore, inicio_teste: float, arq):
    async with vaga:
        inicio = time.perf_counter()
        pendentes, anteriores = [], []

        async def consultar(i: int, fala: str, contexto: list[str]):
            enviado = time.perf_counter()
            linha = {"sessao": s["id"], "fala_indice": i, "fala": fala, "enviada_s": round(enviado - inicio_teste, 2)}
            try:
                r = await cliente.post(f"{url}/api/consultar-qualificado", headers=CABECALHO, json={
                    "frase": fala, "falante": "paciente", "contexto": contexto, "accountId": s["conta"],
                    "materialIds": s["materiais"]})
                linha["http"] = r.status_code
                dados = json.loads(r.text.splitlines()[0]) if r.status_code == 200 else {"erro": r.text[:200]}
            except httpx.HTTPError as erro:
                linha["http"], dados = None, {"erro": type(erro).__name__}
            linha["latencia_ms"] = round((time.perf_counter() - enviado) * 1000)
            linha["erro"] = dados.get("erro")
            linha["motivo_silencio"] = dados.get("motivo_silencio")
            linha["tempos_ms"] = dados.get("tempos_ms")
            linha["vivencia"] = (dados.get("triagem") or {}).get("probabilidade")
            cartoes = dados.get("cartoes") or []
            linha["cartao"] = {k: cartoes[0][k] for k in ("trecho_id", "titulo", "pagina", "paragrafo", "texto",
                                                         "citacao_literal", "probabilidade")} if cartoes else None
            arq.write(json.dumps(linha, ensure_ascii=False) + "\n")
            arq.flush()
            evento(tipo="resposta", sessao=s["id"], fala_indice=i, latencia_ms=linha["latencia_ms"],
                   cartao=linha["cartao"], motivo=linha["motivo_silencio"], erro=linha["erro"],
                   vivencia=linha["vivencia"])

        evento(tipo="inicio", sessao=s["id"], fontes=[f["title"] for f in s["fontes"]])
        falas_paciente = 0
        for momento, papel, texto in s["turnos"]:
            await asyncio.sleep(max(0.0, inicio + momento - time.perf_counter()))
            evento(tipo="fala", sessao=s["id"], papel=papel, texto=texto,
                   fala_indice=falas_paciente if papel == "Paciente" else None)
            if papel == "Paciente":
                pendentes.append(asyncio.create_task(consultar(falas_paciente, texto, anteriores[-5:])))
                anteriores.append(texto)
                falas_paciente += 1
        await asyncio.gather(*pendentes)
        evento(tipo="fim", sessao=s["id"])
        print(f"sessão {s['id']}: {len(s['falas'])} falas em {time.perf_counter() - inicio:.0f} s", flush=True)


def medir_recursos(saida: Path, parar: threading.Event) -> None:
    copiloto = [p for p in psutil.process_iter(["name", "cmdline"])
                if "copiloto.api:app" in " ".join(p.info["cmdline"] or [])]
    with open(saida / "recursos.jsonl", "w", encoding="utf-8") as arq:
        while not parar.wait(5):
            gpu = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
                                  "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout.split(",")
            vm = [p.memory_info().rss for p in psutil.process_iter(["name"]) if p.info["name"] == "vmmemWSL"]
            arq.write(json.dumps({
                "t": time.time(), "gpu_pct": float(gpu[0]) if gpu[0].strip() else None,
                "gpu_mb": float(gpu[1]) if len(gpu) > 1 else None,
                "copiloto_mb": round(sum(p.memory_info().rss for p in copiloto) / 2**20),
                "copiloto_cpu_pct": round(sum(p.cpu_percent() for p in copiloto), 1),
                "vmmem_mb": round(sum(vm) / 2**20), "ram_livre_mb": round(psutil.virtual_memory().available / 2**20),
                "cpu_maquina_pct": psutil.cpu_percent()}) + "\n")
            arq.flush()


def percentis(valores: list[float]) -> dict:
    if not valores:
        return {}
    v = sorted(valores)
    return {"n": len(v), "p50": v[len(v) // 2], "p90": v[int(len(v) * 0.9)], "p99": v[min(len(v) - 1, int(len(v) * 0.99))],
            "max": v[-1], "media": round(statistics.mean(v))}


def resumir(saida: Path, duracao_s: float) -> dict:
    linhas = [json.loads(l) for l in open(saida / "respostas.jsonl", encoding="utf-8")]
    ok = [l for l in linhas if l["http"] == 200 and not l["erro"]]
    etapas = {e: percentis([l["tempos_ms"][e] for l in ok if l["tempos_ms"] and e in l["tempos_ms"]])
              for e in ("risco", "portao", "busca", "juiz", "citacao")}
    preparo = [json.loads(l) for l in open(saida / "preparo.jsonl", encoding="utf-8")]
    resumo = {
        "falas": len(linhas), "respondidas": len(ok), "falhas": len(linhas) - len(ok),
        "falhas_por_tipo": {k: sum(1 for l in linhas if (l["erro"] or l["http"]) == k)
                            for k in {(l["erro"] or l["http"]) for l in linhas if l not in ok}},
        "cartoes": sum(1 for l in ok if l["cartao"]), "silencios": {m: sum(1 for l in ok if l["motivo_silencio"] == m)
                                                                  for m in {l["motivo_silencio"] for l in ok}},
        "latencia_ms": percentis([l["latencia_ms"] for l in linhas]), "etapas_ms": etapas,
        "vazao_falas_por_s": round(len(linhas) / duracao_s, 3), "duracao_s": round(duracao_s),
        "preparo": {"obras": len(preparo), "falharam": sum(not p["ok"] for p in preparo),
                    "segundos": percentis([p["segundos"] for p in preparo])},
    }
    (saida / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    return resumo


async def main() -> None:
    args = argparse.ArgumentParser()
    args.add_argument("run")
    args.add_argument("--simultaneas", type=int, default=8)
    args.add_argument("--minutos", type=float, default=6)
    args.add_argument("--sessoes", type=int, default=100)
    args.add_argument("--ids", nargs="*")
    args.add_argument("--obras-por-tema", type=int)
    args.add_argument("--copiloto", default="http://127.0.0.1:8000")
    args.add_argument("--porta-api", type=int, default=5260)
    a = args.parse_args()
    saida = RAIZ / ".local/simulacao-laya" / a.run
    saida.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", a.porta_api), ApiFalsa).serve_forever, daemon=True).start()
    sessoes = carregar(a.sessoes, a.minutos, a.ids, a.obras_por_tema)
    print(f"{len(sessoes)} sessões, {sum(len(s['falas']) for s in sessoes)} falas do paciente, "
          f"{len({f['pmcid'] for s in sessoes for f in s['fontes']})} obras", flush=True)
    parar = threading.Event()
    threading.Thread(target=medir_recursos, args=(saida, parar), daemon=True).start()
    # sem teto de conexões nem de espera: a fila sob carga tem de aparecer no copiloto, não no cliente de teste
    limites = httpx.Limits(max_connections=None, max_keepalive_connections=100)
    async with httpx.AsyncClient(timeout=httpx.Timeout(1800, pool=None), limits=limites) as cliente:
        await preparar(cliente, a.copiloto, sessoes, saida)
        vaga, inicio = asyncio.Semaphore(a.simultaneas), time.perf_counter()
        with open(saida / "respostas.jsonl", "w", encoding="utf-8") as arq:
            await asyncio.gather(*(sessao(cliente, a.copiloto, s, vaga, inicio, arq) for s in sessoes))
        duracao = time.perf_counter() - inicio
    parar.set()
    print(json.dumps(resumir(saida, duracao), ensure_ascii=False, indent=1), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
