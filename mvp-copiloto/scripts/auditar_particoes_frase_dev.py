"""Verifica repetição de entradas e referências entre as partições de dev."""
from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from copiloto import frase, revisao_fontes


def main() -> None:
    pares, _ = treinar.conjunto_dev()
    pares = revisao_fontes.aplicar(treinar.rotulos_revisados(pares), treinar.TREINO / 'fontes-dev-semantica-v2.jsonl')
    consultas, entradas = defaultdict(list), defaultdict(list)
    for p in pares:
        q = frase.consulta(p['fala'], p['contexto'])
        consultas[hashlib.sha256(q.encode()).hexdigest()].append(p)
        entradas[hashlib.sha256((q + '\0' + p['trecho']).encode()).hexdigest()].append(p)
    def resumo(lista):
        return [{k: p[k] for k in ('id', 'grupo', 'parte', 'arquivo', 'pagina', 'paragrafo', 'alvo')} for p in lista]
    consultas_cruzadas = [resumo(lista) for lista in consultas.values() if len({p['parte'] for p in lista}) > 1]
    entradas_cruzadas = [resumo(lista) for lista in entradas.values() if len({p['parte'] for p in lista}) > 1]
    conflitantes = [resumo(lista) for lista in entradas.values() if len({p['alvo'] >= .5 for p in lista}) > 1]
    resultado = {'split': 'somente-desenvolvimento', 'pares': len(pares),
        'consultas_cruzadas': consultas_cruzadas, 'entradas_cruzadas': entradas_cruzadas,
        'rotulos_conflitantes': conflitantes,
        'pares_sha256': hashlib.sha256(json.dumps(pares, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}
    (RAIZ / 'resultados/auditoria-particoes-frase-dev.json').write_text(json.dumps(resultado, indent=2), encoding='utf-8')
    print(json.dumps({'pares': len(pares), 'consultas_cruzadas': len(consultas_cruzadas),
        'entradas_cruzadas': len(entradas_cruzadas), 'rotulos_conflitantes': len(conflitantes)}), flush=True)


if __name__ == '__main__':
    main()
