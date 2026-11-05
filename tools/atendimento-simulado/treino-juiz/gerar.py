"""Falas sintéticas por passagem: positivos em primeira pessoa e negativos difíceis, mais um pool de conversa e logística.

Uso: gerar.py --saida ARQ [--limite N] [--k 4] [--paralelo P] [--conversa CHAMADAS --saida-conversa ARQ].
Lê <DADOS>/corpus.jsonl; o professor é o llama-server em PROFESSOR_URL. Retoma pelo trecho_id já gravado.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'gold'))

import professor  # noqa: E402
from corpus import DADOS  # noqa: E402
from validar_gold import ngramas, palavras  # noqa: E402

NEGATIVOS = ('negacao', 'terceiro', 'figurado', 'outro_fenomeno')
MIN_PALAVRAS, MAX_PALAVRAS = 12, 45
ROTULO_PERSONA = re.compile(r'^\W*\d+\s*[).:-]|\((?:a|o)\)|\b(?:homem|mulher),\s*\d{2} anos', re.IGNORECASE)
GENEROS = ('mulher', 'homem')
IDADES = ('19 anos', '24 anos', '31 anos', '38 anos', '45 anos', '52 anos', '60 anos', '67 anos')
OCUPACOES = ('estudante universitário(a)', 'motorista de aplicativo', 'professor(a) da rede pública', 'enfermeiro(a)',
             'vendedor(a) de loja', 'aposentado(a)', 'analista de sistemas', 'dono(a) de casa', 'pedreiro / diarista',
             'advogado(a)', 'atendente de telemarketing', 'agricultor(a)', 'cabeleireiro(a)', 'desempregado(a)')
REGISTROS = ('fala simples e direta', 'fala muito, dá voltas', 'usa gírias', 'fala com frases curtas e hesitantes',
             'escolaridade alta, mas sem jargão clínico', 'fala com humor amargo', 'fala emocionado(a)')
REGIOES = ('São Paulo capital', 'interior de Minas', 'Recife', 'Porto Alegre', 'Salvador', 'Belém', 'Goiânia', 'Rio de Janeiro')
SUBTIPOS_CONVERSA = {
    'conversa': 'conversa banal no começo ou no fim da sessão (tempo, trânsito, futebol, novela, comida, bicho de estimação), '
                'sem nenhum conteúdo clínico',
    'logistica': 'logística da terapia (remarcar horário, pagamento, recibo, atestado, plano de saúde, atraso, link da '
                 'chamada, férias do terapeuta)',
    'saudacao': 'cumprimento, despedida ou agradecimento ao terapeuta',
}

SISTEMA = ('Você escreve falas realistas de pacientes brasileiros em sessões de psicoterapia, para treinar um classificador. '
           'Escreva em português do Brasil coloquial, como a pessoa falaria em voz alta.')


def persona(sorteio: random.Random) -> str:
    return (f'{sorteio.choice(GENEROS)}, {sorteio.choice(IDADES)}, {sorteio.choice(OCUPACOES)}, '
            f'{sorteio.choice(REGIOES)}, {sorteio.choice(REGISTROS)}')


def schema_passagem(k: int) -> dict:
    texto = {'type': 'string', 'minLength': 20}
    return {'type': 'object', 'additionalProperties': False,
            'required': ['descreve_vivencia', 'fenomeno', 'positivos', *NEGATIVOS],
            'properties': {'descreve_vivencia': {'type': 'boolean'}, 'fenomeno': texto,
                           'positivos': {'type': 'array', 'items': texto, 'minItems': k, 'maxItems': k},
                           **{n: texto for n in NEGATIVOS}}}


def mensagens_passagem(trecho: dict, k: int) -> list[dict]:
    # Instructions first and the passage last, so the long fixed part is a prefix the server reuses across passages.
    sorteio = random.Random(trecho['trecho_id'])
    personas = '\n'.join(f'{i + 1}) {persona(sorteio)}' for i in range(k))
    usuario = f'''Leia o trecho de artigo clínico no fim e responda com um JSON:
- "descreve_vivencia": true se o trecho descreve algo que uma pessoa pode viver, sentir ou fazer (sintoma, emoção, pensamento, comportamento, dificuldade); false se só fala de método, estatística, serviço ou do efeito de um tratamento sem descrever o problema.
- "fenomeno": em até 15 palavras, o problema vivido que o trecho descreve (nunca a melhora ou o efeito de um tratamento).
- "positivos": {k} falas, uma por persona listada no fim, em que o próprio paciente conta, em primeira pessoa, que vive hoje esse problema, com um detalhe concreto do seu dia a dia. Nada de melhora depois de tratamento. Sem termos técnicos, sem mencionar o artigo, sem escrever a persona na fala.
- "negacao": fala em primeira pessoa sobre o mesmo assunto em que o paciente diz claramente que NÃO vive esse fenômeno.
- "terceiro": fala em que o paciente conta que OUTRA pessoa (parente, colega, amigo) vive esse fenômeno, e ele próprio não.
- "figurado": fala em que o paciente usa uma palavra ou expressão ligada ao tema em sentido figurado ou banal, sem viver o fenômeno.
- "outro_fenomeno": fala em primeira pessoa sobre o mesmo tema geral, mas com um problema clínico diferente do descrito no trecho.
Cada fala tem de {MIN_PALAVRAS} a {MAX_PALAVRAS} palavras, começa de um jeito diferente das outras e não copia 5 palavras seguidas do trecho.

Personas:
{personas}

Trecho:
"""{trecho['texto']}"""'''
    return [{'role': 'system', 'content': SISTEMA}, {'role': 'user', 'content': usuario}]


def motivo_rejeicao(frase: str, texto: str) -> str | None:
    if ROTULO_PERSONA.search(frase):
        return 'rótulo de persona'
    n = len(palavras(frase))
    if not MIN_PALAVRAS <= n <= MAX_PALAVRAS:
        return f'{n} palavras'
    if ngramas(frase) & ngramas(texto):
        return 'copia 5 palavras do trecho'
    return None


def gerar_passagem(trecho: dict, k: int) -> dict:
    base = {'trecho_id': trecho['trecho_id'], 'pmcid': trecho['pmcid'], 'tema': trecho['tema']}
    inicio = time.perf_counter()
    try:
        saida = professor.gerar_json(mensagens_passagem(trecho, k), schema_passagem(k), 900,
                                     zlib.crc32(trecho['trecho_id'].encode()))
    except (ValueError, KeyError) as erro:
        return base | {'erro': f'{type(erro).__name__}: {erro}'[:200], 'segundos': round(time.perf_counter() - inicio, 2)}
    base |= {'tokens': saida['_tokens'], 'segundos': round(time.perf_counter() - inicio, 2)}
    if not saida['descreve_vivencia']:
        return base | {'erro': 'sem vivência'}
    rejeitadas, positivos, negativos = [], [], {}
    candidatas = [('positivo', f) for f in saida['positivos']] + [(n, saida[n]) for n in NEGATIVOS]
    vistas = set()
    for tipo, frase in candidatas:
        frase = frase.strip()
        motivo = motivo_rejeicao(frase, trecho['texto']) or ('repetida' if frase in vistas else None)
        vistas.add(frase)
        if motivo:
            rejeitadas.append({'tipo': tipo, 'frase': frase, 'motivo': motivo})
        elif tipo == 'positivo':
            positivos.append(frase)
        else:
            negativos[tipo] = frase
    return base | {'fenomeno': saida['fenomeno'], 'positivos': positivos, 'negativos': negativos, 'rejeitadas': rejeitadas}


def escolher(corpus: list[dict], limite: int | None) -> list[dict]:
    """Round-robin over articles, so a pilot of N passages spreads over every article."""
    filas = defaultdict(list)
    for trecho in corpus:
        filas[trecho['pmcid']].append(trecho)
    ordem = [t for rodada in range(max(map(len, filas.values()))) for f in filas.values() if rodada < len(f)
             for t in [f[rodada]]]
    return ordem[:limite]


def ler(caminho: Path) -> list[dict]:
    return [json.loads(l) for l in caminho.read_text(encoding='utf-8').splitlines() if l.strip()] if caminho.exists() else []


def rodar(tarefas: list, funcao, caminho: Path, paralelo: int) -> None:
    feitos, inicio, tokens = 0, time.perf_counter(), 0
    with caminho.open('a', encoding='utf-8') as arquivo, ThreadPoolExecutor(paralelo) as pool:
        for futuro in as_completed([pool.submit(funcao, t) for t in tarefas]):
            row = futuro.result()
            arquivo.write(json.dumps(row, ensure_ascii=False) + '\n')
            arquivo.flush()
            feitos, tokens = feitos + 1, tokens + row.get('tokens', 0)
            if feitos % 25 == 0 or feitos == len(tarefas):
                gasto = time.perf_counter() - inicio
                print(f'{feitos}/{len(tarefas)} em {gasto:.0f}s; {tokens / gasto:.1f} tokens gerados/s', flush=True)


def gerar_conversa(tarefa: tuple[int, str]) -> dict:
    indice, subtipo = tarefa
    sorteio = random.Random(f'conversa:{indice}')
    usuario = (f'Escreva 10 falas diferentes de um paciente ({persona(sorteio)}) numa sessão de psicoterapia, do tipo: '
               f'{SUBTIPOS_CONVERSA[subtipo]}. Cada fala tem de {MIN_PALAVRAS} a {MAX_PALAVRAS} palavras. '
               'Responda com um JSON {"falas": [...]}.')
    schema = {'type': 'object', 'additionalProperties': False, 'required': ['falas'],
              'properties': {'falas': {'type': 'array', 'items': {'type': 'string', 'minLength': 20},
                                       'minItems': 10, 'maxItems': 10}}}
    base = {'indice': indice, 'subtipo': subtipo}
    try:
        saida = professor.gerar_json([{'role': 'system', 'content': SISTEMA}, {'role': 'user', 'content': usuario}],
                                     schema, 900, indice)
    except (ValueError, KeyError) as erro:
        return base | {'erro': f'{type(erro).__name__}: {erro}'[:200]}
    falas = [f.strip() for f in saida['falas'] if MIN_PALAVRAS <= len(palavras(f)) <= MAX_PALAVRAS]
    return base | {'tokens': saida['_tokens'], 'falas': list(dict.fromkeys(falas))}


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--limite', type=int)
    parser.add_argument('--k', type=int, default=4)
    parser.add_argument('--paralelo', type=int, default=2)
    parser.add_argument('--conversa', type=int, default=0, help='chamadas do pool de conversa (10 falas cada)')
    parser.add_argument('--saida-conversa', type=Path)
    args = parser.parse_args(argv)
    corpus = ler(DADOS / 'corpus.jsonl')
    feitos = {r['trecho_id'] for r in ler(args.saida)}
    pendentes = [t for t in escolher(corpus, args.limite) if t['trecho_id'] not in feitos]
    print(f'{len(pendentes)} passagens pendentes', flush=True)
    rodar(pendentes, lambda t: gerar_passagem(t, args.k), args.saida, args.paralelo)
    if args.conversa:
        prontos = {r['indice'] for r in ler(args.saida_conversa)}
        tarefas = [(i, sub) for i, sub in enumerate(list(SUBTIPOS_CONVERSA) * args.conversa)][:args.conversa]
        rodar([t for t in tarefas if t[0] not in prontos], gerar_conversa, args.saida_conversa, args.paralelo)
    linhas = ler(args.saida)
    erros = Counter(r['erro'].split(':')[0] for r in linhas if 'erro' in r)
    rejeicoes = Counter(j['motivo'] if 'palavras' not in j['motivo'] else 'fora de 12-45 palavras'
                        for r in linhas for j in r.get('rejeitadas', []))
    aceitas = sum(len(r.get('positivos', [])) + len(r.get('negativos', {})) for r in linhas)
    print(f'{len(linhas)} passagens; erros {dict(erros)}; falas aceitas {aceitas}; rejeitadas {dict(rejeicoes)}')


if __name__ == '__main__':
    main(sys.argv[1:])
