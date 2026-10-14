"""Treino do juiz no Kaggle: dataset privado com os pares, kernel com GPU, espera e download para modelos/juiz-local/<nome>."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / "kaggle"
DADOS = PASTA / "dados"
KERNEL = PASTA / "treinar_kaggle.py"
KAGGLE = Path(sys.executable).parent / "kaggle"
SLUG_DADOS = "copiloto-juiz-pares"
MAQUINA = os.environ.get("COPILOTO_KAGGLE_GPU", "NvidiaTeslaT4")


def ambiente() -> dict:
    env = dict(os.environ)
    if not env.get("KAGGLE_API_TOKEN") and os.name == "nt":
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as chave:
                env["KAGGLE_API_TOKEN"] = winreg.QueryValueEx(chave, "KAGGLE_API_TOKEN")[0]
        except OSError:
            pass
    return env


def credenciais() -> bool:
    env = ambiente()
    return bool(env.get("KAGGLE_API_TOKEN") or (env.get("KAGGLE_USERNAME") and env.get("KAGGLE_KEY"))
                or (Path.home() / ".kaggle" / "access_token").exists() or (Path.home() / ".kaggle" / "kaggle.json").exists())


def utilizador() -> str:
    env = ambiente()
    if env.get("KAGGLE_USERNAME"):
        return env["KAGGLE_USERNAME"]
    arquivo = Path.home() / ".kaggle" / "kaggle.json"
    if arquivo.exists():
        return json.loads(arquivo.read_text())["username"]
    return os.environ.get("COPILOTO_KAGGLE_USER", "joaomorettto")


def kaggle(*args: str, verificar: bool = True) -> str:
    r = subprocess.run([str(KAGGLE), *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=ambiente())
    saida = (r.stdout + r.stderr).strip()
    if verificar and r.returncode:
        raise SystemExit(f"kaggle {' '.join(args[:2])} falhou: {saida[-800:]}")
    return saida


def preparar() -> None:
    from treinar import FRACAO_NEGATIVOS_DO_CASO, FRACAO_NEGATIVOS_PESADOS, _amostra, conjunto_dev

    pares, _ = conjunto_dev()
    validacao = [p for p in pares if p["origem"] != "caso" or p["alvo"] >= 0.5 or _amostra(p, FRACAO_NEGATIVOS_DO_CASO)]
    DADOS.mkdir(parents=True, exist_ok=True)
    with (DADOS / "pares.jsonl").open("w", encoding="utf-8") as saida:
        for p in validacao:
            saida.write(json.dumps({"id": p["id"], "parte": p["parte"], "q": p["q"], "trecho": p["trecho"], "arquivo": p["arquivo"],
                                    "pagina": p["pagina"], "paragrafo": p["paragrafo"], "alvo": float(p["alvo"]), "origem": p["origem"],
                                    "pesado": p["alvo"] >= 0.1 or _amostra(p, FRACAO_NEGATIVOS_PESADOS)}, ensure_ascii=False) + "\n")
    (DADOS / "dataset-metadata.json").write_text(json.dumps({"title": SLUG_DADOS, "id": f"{utilizador()}/{SLUG_DADOS}",
                                                            "licenses": [{"name": "other"}]}, indent=2), encoding="utf-8")
    print(f"{len(validacao)} pares, {sum(p['alvo'] >= 0.5 for p in validacao)} com alvo >= 0,5 -> {DADOS}")


def publicar_dados() -> None:
    ref = f"{utilizador()}/{SLUG_DADOS}"
    existe = "ready" in kaggle("datasets", "status", ref, verificar=False).lower()
    if existe:
        print(kaggle("datasets", "version", "-p", str(DADOS), "-m", time.strftime("%Y-%m-%d %H:%M"), "--dir-mode", "zip"))
    else:
        print(kaggle("datasets", "create", "-p", str(DADOS), "--dir-mode", "zip"))
    for _ in range(60):
        if "ready" in kaggle("datasets", "status", ref, verificar=False).lower():
            return
        time.sleep(10)
    raise SystemExit("dataset nao ficou pronto")


def kernel_id(modelo: str) -> str:
    return f"{utilizador()}/copiloto-juiz-{modelo}"


def enviar(modelo: str, partes: list[int], final: bool) -> bool:
    pasta = PASTA / "kernels" / modelo
    pasta.mkdir(parents=True, exist_ok=True)
    cabecalho = f"MODELO = {modelo!r}\nPARTES_A_CORRER = {partes!r}\nFINAL = {final!r}\n"
    (pasta / "treinar_kaggle.py").write_text(cabecalho + KERNEL.read_text(encoding="utf-8"), encoding="utf-8")
    (pasta / "kernel-metadata.json").write_text(json.dumps({
        "id": kernel_id(modelo), "title": f"copiloto-juiz-{modelo}", "code_file": "treinar_kaggle.py", "language": "python",
        "kernel_type": "script", "is_private": True, "enable_gpu": True, "enable_internet": True, "machine_shape": MAQUINA,
        "dataset_sources": [f"{utilizador()}/{SLUG_DADOS}"], "competition_sources": [], "kernel_sources": [], "model_sources": []},
        indent=2), encoding="utf-8")
    saida = kaggle("kernels", "push", "-p", str(pasta), "--accelerator", MAQUINA)
    print(saida)
    return "successfully pushed" in saida


def estado(modelo: str) -> str:
    texto = kaggle("kernels", "status", kernel_id(modelo), verificar=False).lower()
    for s in ("complete", "error", "cancel", "running", "queued"):
        if s in texto:
            return s
    return texto[-120:]


def esperar(modelos: list[str], intervalo: int = 300) -> dict:
    estados = {}
    while True:
        estados = {m: estado(m) for m in modelos}
        print(time.strftime("%H:%M"), estados, flush=True)
        if all(e in ("complete", "error", "cancel") for e in estados.values()):
            return estados
        time.sleep(intervalo)


def fila(modelos: list[str], ja_enviados: list[str], partes: list[int], final: bool, simultaneos: int = 2, intervalo: int = 300) -> None:
    enviados, feitos = list(ja_enviados), set()
    while len(feitos) < len(modelos):
        estados = {m: estado(m) for m in enviados if m not in feitos}
        print(time.strftime("%H:%M"), estados, flush=True)
        for m, e in estados.items():
            if e in ("complete", "error", "cancel"):
                feitos.add(m)
                if e == "complete":
                    baixar(m)
        ativos = sum(e in ("running", "queued") for e in estados.values())
        for m in [m for m in modelos if m not in enviados][:max(0, simultaneos - ativos)]:
            if enviar(m, partes, final):
                enviados.append(m)
        if len(feitos) < len(modelos):
            time.sleep(intervalo)


def baixar(modelo: str) -> None:
    from treinar import MODELOS, TREINO

    tmp = PASTA / "saidas" / modelo
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    print(kaggle("kernels", "output", kernel_id(modelo), "-p", str(tmp), verificar=False)[-300:])
    origem = next((p.parent for p in tmp.rglob("treino.json")), None)
    if origem is None:
        raise SystemExit(f"{modelo}: sem treino.json na saida (ver {tmp})")
    destino = MODELOS / modelo
    destino.mkdir(parents=True, exist_ok=True)
    if (origem / "torch").exists():
        shutil.rmtree(destino / "torch", ignore_errors=True)
        shutil.copytree(origem / "torch", destino / "torch")
    shutil.copy2(origem / "treino.json", destino / "treino.json")
    oof = origem / f"oof-{modelo}.jsonl"
    if oof.exists():
        alvo = TREINO / f"oof-{modelo}.jsonl"
        novas = [json.loads(l) for l in oof.read_text(encoding="utf-8").splitlines() if l.strip()]
        antigas = [json.loads(l) for l in alvo.read_text(encoding="utf-8").splitlines() if l.strip()] if alvo.exists() else []
        partes = {l["parte"] for l in novas}
        with alvo.open("w", encoding="utf-8") as saida:
            for l in [l for l in antigas if l["parte"] not in partes] + novas:
                saida.write(json.dumps(l, ensure_ascii=False) + "\n")
    print(f"{modelo} -> {destino}")


def main() -> None:
    comando = sys.argv[1] if len(sys.argv) > 1 else "tudo"
    modelos = [a for a in sys.argv[2:] if not a.startswith("--")] or ["gte-r5k", "bge-m3-r5k", "qwen06-r5k", "mxbai15-r5k"]
    partes = next((list(map(int, a.split("=")[1].split(","))) for a in sys.argv if a.startswith("--partes=")), [0, 1, 2])
    final = "--sem-final" not in sys.argv
    if comando == "preparar":
        return preparar()
    if not credenciais():
        raise SystemExit("sem credenciais Kaggle (KAGGLE_API_TOKEN, ~/.kaggle/access_token ou kaggle.json); pacote preparado em kaggle/")
    if comando in ("tudo", "dados"):
        preparar()
        publicar_dados()
    if comando in ("tudo", "enviar"):
        for m in modelos:
            enviar(m, partes, final)
    if comando in ("tudo", "esperar"):
        estados = esperar(modelos)
        for m, e in estados.items():
            if e == "complete":
                baixar(m)
    if comando == "fila":
        enviados = next((a.split("=")[1].split(",") for a in sys.argv if a.startswith("--enviados=")), [])
        fila(modelos, enviados, partes, final)
    if comando == "baixar":
        for m in modelos:
            baixar(m)
    if comando == "estado":
        print({m: estado(m) for m in modelos})


if __name__ == "__main__":
    main()
