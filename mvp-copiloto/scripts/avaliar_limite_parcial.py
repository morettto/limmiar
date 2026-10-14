"""Verifica se as partições restantes ainda podem satisfazer o piso de precisão."""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

from calibrar_contexto import wilson


def limite_otimista(linhas: list[dict], positivos_restantes: int) -> dict:
    if type(positivos_restantes) is not int or positivos_restantes < 0:
        raise ValueError('Número de positivos restantes inválido.')
    for linha in linhas:
        p, alvo = linha['notas']['alvo'], linha['alvo']['alvo']
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1:
            raise ValueError('Pontuação inválida.')
        if type(alvo) not in (int, float) or alvo not in (0, 1):
            raise ValueError('Rótulo inválido.')
    limiares = {.5, 1.}
    for linha in linhas:
        p = linha['notas']['alvo']
        limiares.update(t for t in (p, math.nextafter(p, math.inf)) if .5 <= t <= 1)
    limites = []
    for limiar in limiares:
        aprovadas = [l for l in linhas if l['notas']['alvo'] >= limiar]
        verdadeiros = sum(l['alvo']['alvo'] == 1 for l in aprovadas)
        falsos = len(aprovadas) - verdadeiros
        total = len(aprovadas) + positivos_restantes
        limites.append({'limiar': limiar, 'validos_observados': verdadeiros, 'invalidos_observados': falsos,
                        'positivos_restantes_assumidos_perfeitos': positivos_restantes,
                        'wilson_maximo': wilson(verdadeiros + positivos_restantes, total)})
    return max(limites, key=lambda l: l['wilson_maximo'])


def conferir_versao(versao: dict, nome: str) -> None:
    import treinar
    from copiloto import frase

    cfg = versao['config']
    if not cfg.get('rotulos_duros') or cfg.get('formato') != 'qwen-frase-v2':
        raise ValueError('Diagnóstico exige rótulos revisados de frase atual.')
    arquivos = {'script_sha256': Path(treinar.__file__), 'formato_sha256': Path(frase.__file__)}
    if cfg.get('semantica_v2'):
        arquivos['revisao_fontes_sha256'] = treinar.TREINO / 'fontes-dev-semantica-v2.jsonl'
    for campo, arquivo in arquivos.items():
        if versao.get(campo) != hashlib.sha256(arquivo.read_bytes()).hexdigest():
            raise ValueError(f'Artefato {campo} mudou após a gravação das predições.')
    if 'candidato_sha256' in cfg:
        candidato = RAIZ / 'scripts' / f"treinar_{nome.removeprefix('qwen-').replace('-', '_')}.py"
        if cfg['candidato_sha256'] != hashlib.sha256(candidato.read_bytes()).hexdigest():
            raise ValueError('Candidato mudou após a gravação das predições.')


def main() -> None:
    import treinar
    from copiloto import frase

    nome = sys.argv[1] if len(sys.argv) > 1 else 'qwen-frase-r1'
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    fonte = treinar.TREINO / f'oof-{nome}.jsonl'
    versao = json.loads(fonte.with_suffix('.versao.json').read_text(encoding='utf-8'))
    conferir_versao(versao, nome)
    cfg = versao['config']
    pares, _ = treinar.conjunto_dev()
    pares = treinar.rotulos_revisados(pares)
    if cfg.get('semantica_v2'):
        from copiloto.revisao_fontes import aplicar
        revisao = treinar.TREINO / 'fontes-dev-semantica-v2.jsonl'
        pares = aplicar(pares, revisao)
    pares = [{**p, 'q': frase.consulta(p['fala'], p['contexto'])} for p in pares]
    validacao = [p for p in pares if p['origem'] != 'caso' or p['alvo'] >= .5
                or treinar._amostra(p, treinar.FRACAO_NEGATIVOS_DO_CASO)]
    validacao = treinar.marcar_contrastes_fontes(validacao)
    chave = lambda p: (p['id'], p['arquivo'], p['pagina'], p['paragrafo'])
    esperadas = {chave(p): p for p in validacao}
    linhas = treinar.ler_jsonl(fonte)
    if len({chave(l) for l in linhas}) != len(linhas):
        raise ValueError('Predições duplicadas.')
    for linha in linhas:
        alvo = esperadas.get(chave(linha))
        if (alvo is None or linha['parte'] != alvo['parte'] or linha['alvo']['alvo'] != alvo['alvo']
                or linha['contraste_fonte'] != alvo['contraste_fonte']):
            raise ValueError('Predição não corresponde ao desenvolvimento atual.')
    feitas = {l['parte'] for l in linhas}
    if feitas == {0, 1, 2} or not feitas:
        raise ValueError('Este diagnóstico é apenas para partições incompletas.')
    for k in feitas:
        if {chave(l) for l in linhas if l['parte'] == k} != {chave(l) for l in validacao if l['parte'] == k}:
            raise ValueError('Partição parcialmente gravada; aguarde seu término.')
    contrastes = [l for l in linhas if l['contraste_fonte']]
    restantes = sum(p['contraste_fonte'] and p['alvo'] == 1 and p['parte'] not in feitas for p in validacao)
    resultado = {'modelo': nome, 'validacao_clinica': False, 'particoes_concluidas': sorted(feitas),
                 'pares_observados': len(linhas), 'oof_sha256': hashlib.sha256(fonte.read_bytes()).hexdigest(),
                 'contrastes_observados': len(contrastes), 'piso_wilson': .95,
                 'limite_otimista_contrastes': limite_otimista(contrastes, restantes)}
    resultado['piso_ainda_alcancavel'] = resultado['limite_otimista_contrastes']['wilson_maximo'] >= .95
    destino = treinar.RESULTADOS / f'diagnostico-parcial-{nome}.json'
    destino.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(resultado, ensure_ascii=False), flush=True)
    for linha in sorted((l for l in contrastes if l['alvo']['alvo'] == 0), key=lambda l: -l['notas']['alvo'])[:20]:
        p = esperadas[chave(linha)]
        print(json.dumps({k: p[k] for k in ('id', 'fala', 'contexto', 'trecho', 'arquivo', 'pagina')}
                         | {'score': linha['notas']['alvo']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
