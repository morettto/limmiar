"""Verifica a integração com o Jev (Vercel AI Gateway) contra um servidor simulado. Não precisa de chave real.

  python scripts/teste_jev.py
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("pypdf").setLevel(logging.ERROR)
os.environ.pop("TYPESAFE_API_KEY", None)
os.environ["AI_GATEWAY_API_KEY"] = "vck_teste"
os.environ["COPILOTO_JEV_RETENCAO_ZERO"] = "1"
os.environ["COPILOTO_DECISOR"] = "jev"

from copiloto import busca, decisao, jev, juiz, traducao  # noqa: E402
from copiloto.esquema import conectar  # noqa: E402

pedidos: list[httpx.Request] = []
TRECHO = ("O evitamento de lugares associados ao trauma é um sintoma central do TEPT. "
          "Os pacientes mudam de trajeto para não passar pelo local onde tudo aconteceu, mesmo que isso custe tempo.")


def servidor(prob_t1: float, clinica: float = 0.97, ambigua: float = 0.02):
    def responder(pedido: httpx.Request) -> httpx.Response:
        pedidos.append(pedido)
        corpo = json.loads(pedido.content)
        respostas = {}
        for nome, q in corpo["questions"].items():
            if q["type"] == "choice":
                respostas[nome] = {"type": "choice", "choice": "evitamento_traumatico", "probabilities": {"evitamento_traumatico": 0.9}}
            else:
                p = {"clinica": clinica, "risco": 0.03, "ambigua": ambigua, "T1": prob_t1}.get(nome, 0.02)
                respostas[nome] = {"type": "boolean", "probability": p}
        return httpx.Response(200, json={"answers": respostas, "providerMetadata": {"typesafe": {"confidence": {}}}})
    return httpx.Client(transport=httpx.MockTransport(responder))


def main() -> None:
    triagem, avaliacoes = juiz.avaliar_tudo_jev(
        "eu mudo de caminho pra não passar onde fui assaltada", ["fui assaltada perto da padaria"],
        [("a", TRECHO), ("b", "Tabela 2 apresenta a prevalência por faixa etária.")], servidor(0.93))
    p = pedidos[-1]
    corpo = json.loads(p.content)
    assert str(p.url) == "https://ai-gateway.vercel.sh/v4/ai/evaluation-model", p.url
    assert p.headers["authorization"] == "Bearer vck_teste"
    assert p.headers["ai-model-id"] == "typesafe-ai/jev"
    assert p.headers["ai-evaluation-model-specification-version"] == "4"
    assert p.headers["ai-gateway-auth-method"] == "api-key"
    assert corpo["providerOptions"] == {"gateway": {"zeroDataRetention": True}}
    assert set(corpo["questions"]) == {"clinica", "risco", "ambigua", "T1", "T2", "fenomeno_fala"}
    assert corpo["questions"]["fenomeno_fala"]["type"] == "choice"
    assert corpo["state"]["falas_anteriores"] == ["fui assaltada perto da padaria"]
    assert triagem == {"clinica": 0.97, "risco": 0.03, "ambigua": 0.02}
    a, b = avaliacoes
    assert a.corresponde and a.citacao_confere and a.citacao_literal in TRECHO
    assert not b.corresponde and b.citacao_literal == ""
    print("um pedido por fala, com triagem e juiz juntos: ok")

    falhou = juiz.avaliar_tudo_jev("x", [], [("a", TRECHO)], httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(429))))
    assert falhou == (None, [])
    print("429 ou erro do Jev: nenhuma avaliação: ok")

    con = conectar()
    busca.INDICE.recarregar(con)
    traducao.aquecer()
    fala = "desde o assalto eu dou a volta no bairro pra não passar naquela rua"
    d = decisao.decidir(con, fala, [], "paciente", "pt-BR", cliente=servidor(0.97))
    assert bool(d.cartoes), d.motivo_silencio
    assert juiz.citacao_confere(d.cartoes[0].citacao_literal, d.cartoes[0].texto)
    assert busca._proveniencia_ok(d.cartoes[0].arquivo, d.cartoes[0].pagina, d.cartoes[0].texto)
    print("decisão com Jev aprovando: cartão com citação conferida no PDF: ok")

    d = decisao.decidir(con, fala, [], "paciente", "pt-BR", cliente=servidor(0.97, clinica=0.02))
    assert not d.cartoes and d.motivo_silencio == "sem conteúdo clínico"
    d = decisao.decidir(con, fala, [], "paciente", "pt-BR", cliente=servidor(0.97, ambigua=0.9))
    assert not d.cartoes and d.clarificar
    d = decisao.decidir(con, fala, [], "paciente", "pt-BR", cliente=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    assert not d.cartoes and d.motivo_silencio == "decisor indisponível"
    print("falha do Jev vira silêncio: ok")


def direto() -> None:
    import importlib
    os.environ["TYPESAFE_API_KEY"] = "ts_teste"
    importlib.reload(jev)
    try:
        def responder(pedido: httpx.Request) -> httpx.Response:
            pedidos.append(pedido)
            corpo = json.loads(pedido.content)
            return httpx.Response(200, json={"model": "jev-1.13.0", "answers": {
                nome: {"type": "noul", "noul": 0.8} if q["type"] == "noul" else {"type": "choice", "choice": "x", "probabilities": {"x": 1.0}, "confidence": 0.9}
                for nome, q in corpo["questions"].items()}})
        r = jev.avaliar("fala", {"a": jev.sim_ou_nao("?"), "b": jev.escolha("?", {"x": "x"})}, httpx.Client(transport=httpx.MockTransport(responder)))
        p = pedidos[-1]
        corpo = json.loads(p.content)
        assert str(p.url) == "https://api.typesafe.ai/v1/systemone", p.url
        assert p.headers["authorization"] == "Bearer ts_teste" and "ai-model-id" not in p.headers
        assert corpo["model"] == "jev-latest" and "providerOptions" not in corpo
        assert r["a"] == {"probabilidade": 0.8} and r["b"]["confianca"] == 0.9
        print("API direta da TypeSafe: ok")
    finally:
        os.environ.pop("TYPESAFE_API_KEY")
        importlib.reload(jev)


if __name__ == "__main__":
    main()
    direto()
