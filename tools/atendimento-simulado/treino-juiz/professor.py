"""Cliente do professor: um llama-server local (raciocínio desligado) que gera JSON por schema e dá P(yes) de um par."""
from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'mvp-copiloto' / 'src'))
from copiloto.juiz_llm import pedido_juiz  # noqa: E402

URL = os.environ.get('PROFESSOR_URL', 'http://127.0.0.1:8200')


def _post(caminho: str, corpo: dict, timeout: float = 600, tentativas: int = 4) -> dict:
    pedido = urllib.request.Request(URL + caminho, json.dumps(corpo).encode(), {'Content-Type': 'application/json'})
    for tentativa in range(tentativas):
        try:
            with urllib.request.urlopen(pedido, timeout=timeout) as resposta:
                return json.loads(resposta.read())
        except (urllib.error.URLError, TimeoutError):
            # A run lasts hours on a shared desktop; a transient 5xx or a server restart should not end it.
            if tentativa == tentativas - 1:
                raise
            time.sleep(15 * (tentativa + 1))
    raise AssertionError('unreachable')


def gerar_json(mensagens: list[dict], schema: dict, max_tokens: int, semente: int, temperatura: float = 0.8) -> dict:
    """Raises ValueError when the reply is not one JSON object; the schema grammar alone does not stop truncation."""
    resposta = _post('/v1/chat/completions', {
        'messages': mensagens, 'max_tokens': max_tokens, 'temperature': temperatura, 'top_p': 0.95, 'seed': semente,
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'saida', 'strict': True, 'schema': schema}}})
    escolha = resposta['choices'][0]
    if escolha['finish_reason'] != 'stop':
        raise ValueError(f'resposta truncada ({escolha["finish_reason"]})')
    saida = json.loads(escolha['message']['content'])
    if not isinstance(saida, dict):
        raise ValueError('resposta não é um objeto JSON')
    return saida | {'_tokens': resposta['usage']['completion_tokens']}


def prompt_juiz(trecho: str, frase: str) -> str:
    """The production judge's own request, so training labels and production judgments cannot drift apart."""
    return _post('/apply-template', pedido_juiz(trecho, frase))['prompt']


def p_sim(trecho: str, frase: str) -> float | None:
    """P(yes) / (P(yes) + P(no)) over the first answer token; None when neither is among the top 20."""
    resposta = _post('/completion', {'prompt': prompt_juiz(trecho, frase), 'n_predict': 1, 'n_probs': 20,
                                     'temperature': 0, 'cache_prompt': True})
    massa = {'yes': 0.0, 'no': 0.0}
    for item in resposta['completion_probabilities'][0]['top_logprobs']:
        chave = item['token'].strip().lower()
        if chave in massa:
            massa[chave] += math.exp(item['logprob'])
    total = massa['yes'] + massa['no']
    return massa['yes'] / total if total > 0 else None
