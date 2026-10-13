"""Calibra somente predições fora-da-parte do desenvolvimento; não lê teste ou final."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
# Metas da V1 (7/10/2026): ~90% dos cartões pertinentes e ao menos 70% das fontes pertinentes mostradas.
PISO_WILSON = .88
RECALL_MINIMO = .70


def wilson(acertos: int, total: int) -> float:
    if not total:
        return 0.0
    p, z = acertos / total, 1.96
    return (p + z * z / (2 * total) - z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / (1 + z * z / total)


def medir(linhas: list[dict], limiar: float) -> dict:
    mostradas = [l for l in linhas if l["notas"]["alvo"] >= limiar]
    corretas = sum(l["alvo"]["alvo"] == 1 for l in mostradas)
    positivos = sum(l["alvo"]["alvo"] == 1 for l in linhas)
    negativos = len(linhas) - positivos
    return {
        "limiar": limiar,
        "pares": len(linhas),
        "positivos": positivos,
        "aprovados": len(mostradas),
        "validos_aprovados": corretas,
        "precisao": corretas / len(mostradas) if mostradas else None,
        "precisao_wilson_inferior": wilson(corretas, len(mostradas)),
        "recall_pares": corretas / positivos if positivos else None,
        "falso_positivo_pares": (len(mostradas) - corretas) / negativos if negativos else None,
    }


def calibrar(linhas: list[dict], grupos_dev: dict[str, str]) -> dict:
    vistos = set()
    for l in linhas:
        chave = (l["id"], l["arquivo"], l["pagina"], l["paragrafo"])
        if chave in vistos:
            raise ValueError("Predição duplicada")
        vistos.add(chave)
        p, alvo = l["notas"]["alvo"], l["alvo"]["alvo"]
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1:
            raise ValueError("Probabilidade inválida")
        if type(alvo) not in (int, float) or alvo not in (0, 1):
            raise ValueError("Rótulo deve ser adjudicação binária")
        if type(l.get("contraste_fonte")) is not bool:
            raise ValueError("Predição exige marcação estrita de contraste de fonte")
        grupo = grupos_dev.get(l["id"])
        if (type(l["parte"]) is not int or grupo is None
                or l["parte"] != int(hashlib.sha256(grupo.encode()).hexdigest(), 16) % 3):
            raise ValueError(f"Predição fora do desenvolvimento: {l['id']}")
    if set(l["parte"] for l in linhas) != {0, 1, 2}:
        raise ValueError("Faltam partições fora-da-parte")
    fontes = [l for l in linhas if l["contraste_fonte"]]
    candidatos = [{**medir(linhas, n / 1000), "contrastes_fontes": medir(fontes, n / 1000)} for n in range(500, 1000)]
    elegiveis = [r for r in candidatos if r["precisao_wilson_inferior"] >= PISO_WILSON
                and r["contrastes_fontes"]["precisao_wilson_inferior"] >= PISO_WILSON
                and min(r["recall_pares"] or 0, r["contrastes_fontes"]["recall_pares"] or 0) >= RECALL_MINIMO
                and r["contrastes_fontes"]["falso_positivo_pares"] is not None]
    melhor = max(elegiveis, key=lambda r: (r["recall_pares"], -r["limiar"])) if elegiveis else None
    limiar = melhor["limiar"] if melhor else .95
    por_tipo = {}
    for variante in ("direta", "elipse", "citacao", "terceiro"):
        subset = [l for l in linhas if l["id"].startswith("ctx-dev-") and l["id"].endswith("-" + variante)]
        por_tipo[variante] = medir(subset, limiar)
    return {
        "split": "desenvolvimento-fora-da-parte",
        "validacao_clinica": False,
        "piso_wilson": PISO_WILSON,
        "recall_minimo": RECALL_MINIMO,
        "calibracao_aprovada": melhor is not None,
        "selecionado": melhor,
        "partes": dict(Counter(l["parte"] for l in linhas)),
        "contrastes_contextuais": por_tipo,
        "contrastes_fontes": medir(fontes, limiar),
        "curva": [medir(linhas, p) for p in (.5, .75, .9, .95, .975, .99, .995, .999)],
    }


def main() -> int:
    nome = sys.argv[1] if len(sys.argv) > 1 else "gte-contexto"
    fonte = RAIZ / "data/treino" / f"oof-{nome}.jsonl"
    manifesto = json.loads(fonte.with_suffix(".versao.json").read_text(encoding="utf-8"))
    linhas = [json.loads(l) for l in fonte.read_text(encoding="utf-8").splitlines() if l.strip()]
    grupos_dev = {}
    arquivos_dev = [RAIZ / "data/avaliacao" / n for n in ("dev_positivos.jsonl", "dev_negativos.jsonl")]
    arquivos_dev += [RAIZ / "data/treino" / n for n in
                    ("casos_aug.jsonl", "triagem_sintetica.jsonl", "claude-r4.jsonl", "claude-r5.jsonl", "contexto-dev.jsonl")]
    for arquivo in arquivos_dev:
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            caso = json.loads(linha)
            grupos_dev[caso["id"]] = caso.get("grupo", caso["id"])
    if manifesto["config"].get("rotulos_revisados"):
        import re
        grupos_dev = {k: re.sub(r"^(p\d+)-(?:\d+|n)$", r"\1", v) for k, v in grupos_dev.items()}
    resultado = calibrar(linhas, grupos_dev)
    resultado["oof_sha256"] = hashlib.sha256(fonte.read_bytes()).hexdigest()
    resultado["manifesto"] = manifesto
    destino = RAIZ / "resultados" / f"calibracao-contexto-{nome}.json"
    destino.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in resultado.items() if k not in ("manifesto", "curva")}, ensure_ascii=False), flush=True)
    return 0 if resultado["calibracao_aprovada"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
