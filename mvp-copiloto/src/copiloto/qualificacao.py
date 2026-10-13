from __future__ import annotations

import json
import math

from .esquema import RAIZ

ALVOS = [
    ("precisão dos cartões (limite inferior de Wilson)", "precisao_limite_inferior", ">=", 0.88),
    ("falas com referência pertinente encontrada", "cobertura_geral", ">=", 0.70),
    ("cartões em falas neutras", ("falso_alarme_por_tipo", "neutro"), "<=", 0.01),
    ("cartões em falas do terapeuta", ("falso_alarme_por_tipo", "terapeuta"), "<=", 0.0),
    ("cartões em quase acertos", ("falso_alarme_por_tipo", "quase"), "<=", 0.02),
    ("falas de risco sinalizadas", "risco_alertado", ">=", 0.95),
    ("falas ambíguas sinalizadas para clarificar", "ambiguo_alertado", ">=", 0.90),
    ("cartões por adjudicar", "cartoes_por_adjudicar", "<=", 0),
    ("recuperação das referências esperadas", "recall_candidatos", ">=", .95),
    ("tempo até o primeiro cartão (p95 em segundos)", "primeiro_cartao_p95_s", "<=", 3.0),
]


def valor(relatorio: dict, chave):
    if isinstance(chave, tuple):
        grupo = relatorio.get(chave[0])
        return grupo.get(chave[1]) if isinstance(grupo, dict) else None
    return relatorio.get(chave)


def atende_alvos(relatorio: dict) -> bool:
    for _, chave, sinal, alvo in ALVOS:
        medido = valor(relatorio, chave)
        teto = 3.0 if chave == "primeiro_cartao_p95_s" else 1.0
        if (type(medido) not in (int, float) or not math.isfinite(medido)
                or medido < 0 or medido > teto or not (medido >= alvo if sinal == ">=" else medido <= alvo)):
            return False
    return True


def faixas(juiz: str) -> dict | None:
    """As faixas {forte, possivel} da versão do juiz promovida no registro; None se ela não consta como promovida."""
    arquivo = RAIZ / "data" / "juiz-v2" / "registro.jsonl"
    try:
        linhas = [json.loads(linha) for linha in arquivo.read_text(encoding="utf-8").splitlines() if linha.strip()]
        for linha in linhas:
            if linha["versao"] == juiz and linha.get("promovida") is True:
                forte, possivel = linha["limiares"]["forte"], linha["limiares"]["possivel"]
                if all(type(v) in (int, float) for v in (forte, possivel)) and 0 < possivel <= forte <= 1:
                    return {"forte": forte, "possivel": possivel}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def qualificado(juiz: str) -> bool:
    return bool(juiz) and faixas(juiz) is not None
