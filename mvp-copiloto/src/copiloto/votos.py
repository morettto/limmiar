"""Contrato e limpeza dos votos útil/não útil dos profissionais (entrada do retreino do juiz)."""
from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Callable, Iterable
from pathlib import Path

VOTOS = {"util": 1, "nao_util": 0}
CAMPOS = ("v", "consentiu", "usuario", "fala", "contexto", "trecho", "obra", "voto", "juiz", "em")
EMPATE = (0.4, 0.6)
ARQUIVO = Path(__file__).resolve().parents[2] / "data" / "votos" / "votos.jsonl"
LIMITE_FALA, LIMITE_TRECHO, LIMITE_ITEM, LIMITE_CONTEXTO, LIMITE_CAMPO = 2000, 3000, 2000, 5, 200


def chave(fala: str, trecho: str) -> str:
    """Identidade do par: a mesma fala com o mesmo trecho é o mesmo par, venha de quem vier."""
    return hashlib.sha256(f"{' '.join(fala.split())}\x1f{' '.join(trecho.split())[:300]}".encode()).hexdigest()[:24]


def valido(e: object) -> bool:
    return (isinstance(e, dict) and all(c in e for c in CAMPOS) and e["v"] == 1 and e["consentiu"] is True
            and isinstance(e["usuario"], str) and e["usuario"] != "" and e["voto"] in VOTOS
            and all(isinstance(e[c], str) and e[c].strip() for c in ("fala", "trecho", "obra", "juiz", "em"))
            and isinstance(e["contexto"], list) and all(isinstance(x, str) for x in e["contexto"]))


def dentro_dos_limites(e: dict) -> bool:
    return (len(e["fala"]) <= LIMITE_FALA and len(e["trecho"]) <= LIMITE_TRECHO
            and len(e["contexto"]) <= LIMITE_CONTEXTO and all(len(x) <= LIMITE_ITEM for x in e["contexto"])
            and all(len(e[c]) <= LIMITE_CAMPO for c in ("usuario", "obra", "voto", "juiz", "em")))


def limpar(eventos: Iterable[object], excluir: frozenset[str] | set[str] = frozenset(), minimo_usuarios: int = 1,
           prosa: Callable[[str], bool] | None = None) -> list[dict]:
    """Votos válidos e consentidos viram um rótulo por par: último voto de cada usuário, maioria entre usuários.

    Descartados: sem consentimento, par do teste fixo (`excluir`), trecho que não é prosa, poucos usuários, empate.
    """
    ultimo: dict[tuple[str, str], dict] = {}
    for e in eventos:
        if not valido(e):
            continue
        k = (e["usuario"], chave(e["fala"], e["trecho"]))
        if k not in ultimo or e["em"] >= ultimo[k]["em"]:
            ultimo[k] = e
    por_par: dict[str, list[dict]] = defaultdict(list)
    for (_, c), e in ultimo.items():
        por_par[c].append(e)
    saida = []
    for c, votos in por_par.items():
        amostra = votos[0]
        if c in excluir or len(votos) < minimo_usuarios or (prosa is not None and not prosa(amostra["trecho"])):
            continue
        media = sum(VOTOS[v["voto"]] for v in votos) / len(votos)
        if EMPATE[0] < media < EMPATE[1]:
            continue
        saida.append({"id": "fb-" + c, "fala": amostra["fala"], "contexto": amostra["contexto"], "trecho": amostra["trecho"],
                      "arquivo": amostra["obra"], "alvo": int(media >= EMPATE[1]), "origem": "feedback", "trecho_id": c,
                      "usuarios": len(votos)})
    return saida
