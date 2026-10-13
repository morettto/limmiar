"""Teste de fumaça de uma réplica do juiz.

Uso: COPILOTO_JUIZ_URL=http://host:8000 COPILOTO_JUIZ_CHAVE=chave python tools/juiz/smoke.py
"""
import os
import sys
import time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mvp-copiloto", "src"))
from copiloto import juiz_llm

FALA = "toda vez que vejo um elevador meu peito aperta e eu subo de escada, mesmo cansada"
SIM = "O medo de espaços fechados leva à evitação e à sensação de aperto no peito diante de elevadores."
NAO = "A prevalência de depressão em idosos aumentou entre 2010 e 2020 segundo o levantamento nacional."

assert juiz_llm.configurado(), "defina COPILOTO_JUIZ_URL"
assert httpx.get(f"{juiz_llm.URL}/health", timeout=10).status_code == 200, "o servidor não está saudável"
if juiz_llm.CHAVE:
    assert httpx.get(f"{juiz_llm.URL}/v1/models", timeout=10).status_code == 401, "o servidor aceitou uma requisição sem chave"
cabecalho = {"Authorization": f"Bearer {juiz_llm.CHAVE}"} if juiz_llm.CHAVE else {}
publicados = {m["id"] for m in httpx.get(f"{juiz_llm.URL}/v1/models", headers=cabecalho, timeout=10).json()["data"]}
assert juiz_llm.MODELO in publicados, f"o servidor não publica o juiz: {publicados}"

inicio = time.perf_counter()
notas = juiz_llm.julgar(FALA, [], [SIM, NAO])
print(f"notas {notas} em {time.perf_counter() - inicio:.2f}s; reescrita: {juiz_llm.reescrever(FALA, [])}")
assert notas[0] > 0.7 > notas[1], "o juiz não separou o trecho certo do errado"
