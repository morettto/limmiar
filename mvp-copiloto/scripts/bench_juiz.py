"""Benchmark do juiz sobre pares (fala, trecho) já julgados, sem busca.

  python scripts/bench_juiz.py <modelo.gguf> [nome] [--raciocinio]
  python scripts/bench_juiz.py jev          (precisa de AI_GATEWAY_API_KEY)
  python scripts/bench_juiz.py classificador:<openjev|kev|cross>:<pasta ou repo HF>[@4bit] <nome>   (torch; lotes de 20 pares)
  python scripts/bench_juiz.py classificador:treinado:gte-r2 <nome>   (inferência local do produto, textos completos)

Pares: cada positivo de dev com o trecho de onde foi escrito (válido), e os pares adjudicados em
data/avaliacao/dev_adjudicacoes.jsonl (válidos e inválidos). Sobe um llama-server próprio na porta 8091.
"""

from __future__ import annotations

import json
import hashlib
import subprocess
import sys
import time
from pathlib import Path

import httpx

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PORTA = 8091
import os  # noqa: E402

os.environ["COPILOTO_JUIZ_URL"] = f"http://127.0.0.1:{PORTA}"
os.environ["COPILOTO_JUIZ_TIMEOUT"] = "120"
from copiloto import juiz  # noqa: E402


def pares() -> list[dict]:
    fonte = {}
    for linha in (RAIZ / "data" / "trechos_fonte.jsonl").open(encoding="utf-8"):
        t = json.loads(linha)
        fonte[(t["arquivo"], t["pagina"], t["paragrafo"])] = t["texto"]
    saida = []
    for linha in (RAIZ / "data" / "avaliacao" / "dev_positivos.jsonl").open(encoding="utf-8"):
        c = json.loads(linha)
        f = c["fonte"]
        texto = fonte.get((f["arquivo"], f["pagina"], f["paragrafo"]))
        if texto:
            saida.append({"id": c["id"], "fala": c["fala"], "contexto": c["contexto"], "trecho": texto, "valido": True, "origem": "rotulo"})
    fila = [json.loads(l) for l in (RAIZ / "resultados" / "adjudicar-dev.jsonl").open(encoding="utf-8")]
    vereditos = [json.loads(l) for l in (RAIZ / "data" / "avaliacao" / "dev_adjudicacoes.jsonl").open(encoding="utf-8")]
    por_chave = {}
    for v in vereditos:
        if type(v["valido"]) is not bool:
            raise ValueError("Revisão deve usar booleano estrito")
        chave = (v["id"], v["arquivo"], int(v["pagina"]))
        if chave in por_chave and por_chave[chave]["valido"] != v["valido"]:
            raise ValueError("Revisões conflitantes")
        por_chave[chave] = v
    for item in fila:
        v = por_chave.get((item["id"], item["arquivo"], int(item["pagina"])))
        if v is None:
            continue
        saida.append({"id": item["id"], "fala": item["fala"], "contexto": item["contexto"], "trecho": item["trecho_aprovado"],
                      "valido": v["valido"], "origem": "adjudicado"})
    return saida


def julgar_jev_em_lotes(lista: list[dict], tamanho: int = 12) -> list[dict]:
    from copiloto import jev

    resultados = []
    for inicio_lote in range(0, len(lista), tamanho):
        lote = lista[inicio_lote:inicio_lote + tamanho]
        ids = [f"C{i + 1}" for i in range(len(lote))]
        estado = {"casos": {cid: {"fala_do_paciente": p["fala"], "falas_anteriores": p["contexto"][-5:],
                                   "trecho": p["trecho"][:juiz.MAX_CARACTERES_TRECHO]} for cid, p in zip(ids, lote)}}
        perguntas = {cid: jev.sim_ou_nao(f"No caso {cid}, o trecho descreve o mesmo fenômeno clínico que o paciente expressa na fala_do_paciente desse caso? {juiz.REGRAS_JEV}") for cid in ids}
        inicio = time.perf_counter()
        try:
            respostas = jev.avaliar(estado, perguntas)
        except (httpx.HTTPError, KeyError, ValueError) as erro:
            print("  lote falhou:", type(erro).__name__, flush=True)
            respostas = {}
        ms = (time.perf_counter() - inicio) * 1000 / len(lote)
        for cid, p in zip(ids, lote):
            prob = (respostas.get(cid) or {}).get("probabilidade")
            resultados.append({**{k: p[k] for k in ("id", "valido", "origem")}, "ms": round(ms), "falhou": prob is None,
                               "corresponde": bool(prob is not None and prob >= 0.5), "prob": prob or 0.0, "cita_ok": True})
        print(f"  {min(inicio_lote + tamanho, len(lista))}/{len(lista)}", flush=True)
    return resultados


HIPOTESE = os.environ.get("BENCH_HIPOTESE", "Este trecho descreve o mesmo fenômeno clínico que o paciente expressa ao dizer: \"{fala}\"")


def pontuador(tipo: str, caminho: str):
    if tipo == "treinado":
        from copiloto import treinado

        def pontuar(lote):
            return [linha[0] for linha in treinado._sigmoide(caminho,
                    [treinado.consulta_para_modelo(p["fala"], p["contexto"], caminho) for p in lote], [p["trecho"] for p in lote])]
        return pontuar
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
    quatro_bits = caminho.endswith("@4bit")
    caminho = caminho.removesuffix("@4bit")
    quant = {}
    if quatro_bits:
        from transformers import BitsAndBytesConfig
        quant = {"quantization_config": BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16),
                 "device_map": {"": 0}}
    if tipo == "kev":
        import transformers
        from kev.checkpoint import Checkpoint, LoadOptions

        if quant:
            original = transformers.AutoModelForCausalLM.from_pretrained
            transformers.AutoModelForCausalLM.from_pretrained = lambda *a, **k: original(*a, **{**k, "dtype": torch.float16, **quant})
            import kev.model
            kev.model.AutoModelForCausalLM = transformers.AutoModelForCausalLM
        ck = Checkpoint(caminho)
        tok, modelo = ck.load(dispositivo, LoadOptions(dtype=torch.float16 if quant else torch.float32, merge=not quant))
        if quant:
            modelo.head.to(dispositivo)
        pergunta = {"type": "noul", "instructions": f"O trecho descreve o mesmo fenômeno clínico que o paciente expressa na fala_do_paciente? {juiz.REGRAS_JEV}"}

        def pontuar(lote):
            from kev.api import SystemOneRequest, to_record
            encs = [modelo.encode(tok, to_record(SystemOneRequest(state={"fala_do_paciente": p["fala"], "falas_anteriores": p["contexto"][-5:],
                                                                             "trecho": p["trecho"][:juiz.MAX_CARACTERES_TRECHO]},
                                                                      questions={"q": pergunta}))[0], max_state=1024)
                    for p in lote]
            with torch.no_grad():
                return [float(torch.softmax(z[0].float(), -1)[1]) for z in modelo.forward_batch(encs)]
        return pontuar
    tok = AutoTokenizer.from_pretrained(caminho)
    modelo = AutoModelForSequenceClassification.from_pretrained(caminho, dtype=torch.float16 if quant else torch.float32, **quant)
    if not quant:
        modelo.to(dispositivo)
    modelo.eval()
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    modelo.config.pad_token_id = tok.pad_token_id
    if tipo == "openjev":
        tok.padding_side = "right"
        modelo.config.get_text_config().pad_token_id = tok.pad_token_id
        molde = modelo.config.nli_template

        def textos(lote):
            return [molde.format(premise=p["trecho"][:juiz.MAX_CARACTERES_TRECHO], hypothesis=HIPOTESE.format(fala=p["fala"])) for p in lote], None
    else:
        def textos(lote):
            return [p["fala"] for p in lote], [p["trecho"][:juiz.MAX_CARACTERES_TRECHO] for p in lote]

    def pontuar(lote):
        a, b = textos(lote)
        enc = tok(a, b, truncation=True, max_length=1024, padding=True, return_tensors="pt").to(modelo.device)
        with torch.no_grad():
            logits = modelo(**enc).logits.float()
        return (torch.softmax(logits, -1)[:, 1] if logits.shape[-1] == 3 else torch.sigmoid(logits[:, 0])).tolist()
    return pontuar


def julgar_classificador(lista: list[dict], pontuar, tamanho: int = 20) -> tuple[list[dict], list[float]]:
    pontuar(lista[:2])
    resultados, lotes_ms = [], []
    for inicio_lote in range(0, len(lista), tamanho):
        lote = lista[inicio_lote:inicio_lote + tamanho]
        inicio = time.perf_counter()
        probs = pontuar(lote)
        lotes_ms.append((time.perf_counter() - inicio) * 1000)
        for p, prob in zip(lote, probs):
            resultados.append({**{k: p[k] for k in ("id", "valido", "origem")}, "ms": round(lotes_ms[-1] / len(lote)), "falhou": prob != prob,
                               "corresponde": prob >= 0.5, "prob": prob, "cita_ok": True})
    return resultados, lotes_ms


def wilson_inferior(certos: int, n: int, z: float = 1.96) -> float:
    if not n:
        return 0.0
    p = certos / n
    return (p + z * z / (2 * n) - z * ((p * (1 - p) + z * z / (4 * n)) / n) ** 0.5) / (1 + z * z / n)


def subir(modelo: Path, raciocinio: bool) -> subprocess.Popen:
    comando = [str(RAIZ / "ferramentas" / "llama" / "llama-server.exe"), "-m", str(modelo), "-ngl", "99", "-c", "8192", "-np", "1",
               "--port", str(PORTA), "--host", "127.0.0.1", "--jinja", "--reasoning", "on" if raciocinio else "off"]
    processo = subprocess.Popen(comando, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(180):
        try:
            if httpx.get(f"http://127.0.0.1:{PORTA}/health", timeout=2).status_code == 200:
                return processo
        except httpx.HTTPError:
            pass
        time.sleep(1)
    processo.kill()
    raise SystemExit("llama-server não subiu")


def main() -> None:
    usa_jev = sys.argv[1] == "jev"
    classificador = sys.argv[1].startswith("classificador:")
    modelo = Path(sys.argv[1])
    nome = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else modelo.stem
    raciocinio = "--raciocinio" in sys.argv
    if raciocinio:
        nome += "-raciocinio"
    lista = pares()
    print(f"{nome}: {len(lista)} pares ({sum(p['valido'] for p in lista)} válidos)", flush=True)
    if usa_jev and not os.environ.get("AI_GATEWAY_API_KEY"):
        raise SystemExit("defina AI_GATEWAY_API_KEY")
    lotes_ms: list[float] = []
    if classificador:
        _, tipo, caminho = sys.argv[1].split(":", 2)
        resultados, lotes_ms = julgar_classificador(lista, pontuador(tipo, caminho))
        processo = None
    elif usa_jev:
        resultados = julgar_jev_em_lotes(lista)
        processo = None
    else:
        processo = subir(modelo, raciocinio)
        resultados = []
    julgar = juiz.avaliar
    try:
        with httpx.Client(timeout=120) as cliente:
            for p in ([] if usa_jev or classificador else lista):
                inicio = time.perf_counter()
                av = julgar(p["fala"], p["contexto"], [("x", p["trecho"])], cliente)
                ms = (time.perf_counter() - inicio) * 1000
                a = av[0] if av else None
                resultados.append({**{k: p[k] for k in ("id", "valido", "origem")}, "ms": round(ms),
                                   "falhou": a is None, "corresponde": bool(a and a.corresponde),
                                   "prob": a.probabilidade if a else 0.0, "cita_ok": bool(a and a.citacao_confere)})
    finally:
        if processo:
            processo.kill()
    destino = RAIZ / "resultados" / f"bench-juiz-{nome}.jsonl"
    destino.write_text("".join(json.dumps(r) + "\n" for r in resultados), encoding="utf-8")
    from copiloto import metadados, treinado

    destino.with_suffix(".versao.json").write_text(json.dumps({
        "split": "desenvolvimento", "tipo_avaliacao": "pares_sem_busca_ou_verificacao_de_proveniencia",
        "source_hashes": metadados.hashes((RAIZ / "src/copiloto").glob("*.py")),
        "bench_hash": metadados.hashes([Path(__file__)]),
        "model_hashes": metadados.hashes(treinado.pasta(caminho).glob("*")) if classificador and tipo == "treinado" else {},
        "pares_sha256": hashlib.sha256(json.dumps(lista, sort_keys=True).encode()).hexdigest(),
        "dtype": os.environ.get("COPILOTO_JUIZ_DTYPE", "float32"),
    }, indent=2), encoding="utf-8")
    ms = sorted(r["ms"] for r in resultados)
    print(f"  falhas {sum(r['falhou'] for r in resultados)}  latência p50 {ms[len(ms)//2]} ms  p95 {ms[int(len(ms)*0.95)]} ms")
    if lotes_ms:
        import psutil
        import torch
        lotes_ms.sort()
        print(f"  lote de 20 trechos p50 {lotes_ms[len(lotes_ms)//2]:.0f} ms  máx {lotes_ms[-1]:.0f} ms"
              f"  pico VRAM {torch.cuda.max_memory_allocated() / 2**30 if torch.cuda.is_available() else 0:.2f} GiB"
              f"  pico RAM {getattr(psutil.Process().memory_info(), 'peak_wset', psutil.Process().memory_info().rss) / 2**30:.2f} GiB")
    for limiar in (0.5, 0.8, 0.9, 0.95, 0.99, 0.999):
        aprovados = [r for r in resultados if r["corresponde"] and r["cita_ok"] and r["prob"] >= limiar]
        certos = sum(r["valido"] for r in aprovados)
        validos = sum(r["valido"] for r in resultados)
        dificeis = [r for r in resultados if r["origem"] == "adjudicado" and not r["valido"]]
        print(f"  limiar {limiar:<4} aprovados {len(aprovados):3}  precisão {certos / len(aprovados) if aprovados else 0:.3f}"
              f"  wilson95 {wilson_inferior(certos, len(aprovados)):.3f}"
              f"  recall {certos / validos:.3f}  falsos difíceis aprovados {sum(1 for r in aprovados if r in dificeis)}/{len(dificeis)}")


if __name__ == "__main__":
    main()
