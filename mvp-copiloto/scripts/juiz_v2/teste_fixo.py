"""Teste fixo do juiz: congelado, nunca treinado, é a única régua de promoção. Uso: teste_fixo.py construir [--nova-versao]."""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from copiloto.votos import chave

RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "data" / "juiz-v2"
ARQUIVO = DADOS / "teste-fixo.jsonl"
MANIFESTO = DADOS / "teste-fixo.manifesto.json"
UMA_EM_CADA = 5
SIM_NAO = {"sim": 1, "nao": 0}


def obra(arquivo: str) -> str:
    """A mesma obra aparece com e sem .pdf e com o nome cortado em tamanhos diferentes; a identidade é o começo do nome."""
    return arquivo.lower().removesuffix(".pdf")[:50]


def obra_de_teste(arquivo: str) -> bool:
    """Uma obra em cada cinco nunca entra em treino, para sempre (decidido pelo nome, não por sorteio)."""
    return int(hashlib.sha256(obra(arquivo).encode()).hexdigest(), 16) % UMA_EM_CADA == 0


def linha(r: dict) -> dict:
    return {**r, "trecho_id": chave(r["fala"], r["trecho"])}


def rotulos_do_usuario(cartoes: list[dict], respostas: dict[str, str]) -> list[dict]:
    """O voto do profissional é o padrão-ouro; 'dúvida' não entra."""
    return [linha({"id": c["k"].split("|")[0], "fala": c["fala"], "contexto": c["ctx"], "trecho": c["trecho"],
                   "arquivo": c["obra"], "alvo": SIM_NAO[respostas[c["k"]]], "origem": "rotulo_usuario"})
            for c in cartoes if respostas.get(c["k"]) in SIM_NAO]


def montar(base: list[dict], usuario: list[dict]) -> list[dict]:
    """Obras de teste inteiras mais todos os rótulos do usuário; no mesmo par, o usuário vence a base."""
    do_usuario = {r["trecho_id"] for r in usuario}
    fixo = [linha(r) for r in base if obra_de_teste(r["arquivo"])]
    return [r for r in fixo if r["trecho_id"] not in do_usuario] + usuario


def treino_permitido(r: dict, fixos: set[str]) -> bool:
    return not obra_de_teste(r["arquivo"]) and chave(r["fala"], r["trecho"]) not in fixos


def congelar(linhas: list[dict], nova_versao: bool = False) -> dict:
    corpo = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in linhas)
    manifesto = {"n": len(linhas), "sha256": hashlib.sha256(corpo.encode()).hexdigest(), "por_origem": dict(Counter(r["origem"] for r in linhas)),
                 "positivos": sum(r["alvo"] for r in linhas), "obras": sorted({obra(r["arquivo"]) for r in linhas})}
    if MANIFESTO.exists() and not nova_versao and json.loads(MANIFESTO.read_text(encoding="utf-8"))["sha256"] != manifesto["sha256"]:
        raise SystemExit("O teste fixo já está congelado e este conteúdo é outro. Mudar a régua exige --nova-versao e reavaliar o juiz ativo.")
    ARQUIVO.write_text(corpo, encoding="utf-8")
    MANIFESTO.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifesto


def main() -> None:
    base = [json.loads(l) for l in (DADOS / "treino-lora.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    usuario = []
    respostas = DADOS / "rotulos-usuario.json"
    if respostas.exists():
        cartoes = json.loads((DADOS / "rotulagem-usuario.json").read_text(encoding="utf-8"))["cards"]
        usuario = rotulos_do_usuario(cartoes, json.loads(respostas.read_text(encoding="utf-8")))
    print(json.dumps(congelar(montar(base, usuario), "--nova-versao" in sys.argv), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
