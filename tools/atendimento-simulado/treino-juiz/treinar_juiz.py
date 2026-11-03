"""Treina o juiz final nos pools da busca real rotulados pela rubrica (nota 2 = explica; 1 e 0 = não).

Uso: treinar_juiz.py --aluno gte|qwen --pools ARQ --saida DIR [--base REPO] [--adaptador DIR] [--epocas 3] [--minutos 120] [--lr 2e-4].
Cada linha de ARQ é uma fala com o seu pool: {fid, pmcid, frase, cands: [{trecho_id, pmcid, texto, nota}]}.
Um passo vê o pool inteiro de uma fala: a perda listwise ensina a ordenar contra os distratores que a busca devolve, e a
pointwise ensina o corte absoluto, porque uma fala sem trecho que a explique não pode ter nota alta em nenhum.
Divisão por artigo: a fala é de validação se o artigo de origem é; trechos de artigos de validação saem dos pools de
treino, para a validação medir passagens nunca vistas.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch

from treinar import BASES, Gte, Qwen, meia_precisao, validacao

import bakeoff_juiz  # noqa: E402  (treinar puts gold/ on sys.path)


def ler_pools(caminho: Path) -> list[dict]:
    return [json.loads(l) for l in caminho.read_text(encoding='utf-8').splitlines() if l.strip()]


def dividir(pools: list[dict]) -> tuple[list[dict], list[dict]]:
    treino, valida = [], []
    for pool in pools:
        if validacao(pool['pmcid']):
            valida.append(pool)
        else:
            cands = [c for c in pool['cands'] if not validacao(c['pmcid'])]
            if cands:
                treino.append({**pool, 'cands': cands})
    return treino, valida


def perda_pool(logits: torch.Tensor, alvo: torch.Tensor, peso_lista: float) -> torch.Tensor:
    pontual = torch.nn.functional.binary_cross_entropy_with_logits(logits, alvo)
    if alvo.sum() == 0:
        return pontual
    # -log of the softmax mass on the passages that explain the statement
    lista = -(torch.logsumexp(logits[alvo > 0], 0) - torch.logsumexp(logits, 0))
    return pontual + peso_lista * lista


def prever(aluno, pools: list[dict], lote: int) -> list[np.ndarray]:
    aluno.modelo.eval()
    saida = []
    with torch.inference_mode(), meia_precisao():
        for pool in pools:
            textos, notas = [c['texto'] for c in pool['cands']], []
            for i in range(0, len(textos), lote):
                notas += aluno.logits([pool['frase']] * len(textos[i:i + lote]), textos[i:i + lote]).sigmoid().tolist()
            saida.append(np.array(notas))
    aluno.modelo.train()
    return saida


def medir(pools: list[dict], notas: list[np.ndarray]) -> dict:
    """Top-1 of each pool: the share of statements with an explaining passage whose top-1 explains it, and AUROC."""
    from sklearn.metrics import roc_auc_score

    y = np.concatenate([[c['nota'] == 2 for c in p['cands']] for p in pools]).astype(int)
    x = np.concatenate(notas)
    com = [(p, n) for p, n in zip(pools, notas) if any(c['nota'] == 2 for c in p['cands'])]
    topo = sum(p['cands'][int(n.argmax())]['nota'] == 2 for p, n in com)
    return {'auroc': round(float(roc_auc_score(y, x)), 4) if 0 < y.sum() < len(y) else None,
            'topo1_certo': f'{topo}/{len(com)}', 'pares': int(len(y)), 'positivos': int(y.sum())}


def main(argv: list[str]) -> None:
    from sklearn.isotonic import IsotonicRegression

    parser = argparse.ArgumentParser()
    parser.add_argument('--aluno', choices=('gte', 'qwen'), required=True)
    parser.add_argument('--pools', type=Path, required=True)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--base')
    parser.add_argument('--adaptador', type=Path, help='LoRA de partida com a mesma configuração (ex.: aluno-gte-v1)')
    parser.add_argument('--epocas', type=int, default=3)
    parser.add_argument('--minutos', type=float, default=120)
    parser.add_argument('--lr', type=float, default=2e-4)
    parser.add_argument('--peso-lista', type=float, default=1.0)
    parser.add_argument('--acumular', type=int, default=4)
    parser.add_argument('--lote', type=int, default=6, help='pares por passada; um pool maior é dividido')
    args = parser.parse_args(argv)
    torch.manual_seed(0)
    treino, valida = dividir(ler_pools(args.pools))
    print(f'{len(treino)} falas de treino ({sum(len(p["cands"]) for p in treino)} pares), {len(valida)} de validação',
          flush=True)
    aluno = (Gte if args.aluno == 'gte' else Qwen)(args.base or BASES[args.aluno])
    if args.adaptador:
        from peft import set_peft_model_state_dict
        from safetensors.torch import load_file
        faltando = set_peft_model_state_dict(aluno.modelo, load_file(args.adaptador / 'adapter_model.safetensors'))
        assert not faltando.unexpected_keys, faltando.unexpected_keys[:5]
    treinaveis = [p for p in aluno.modelo.parameters() if p.requires_grad]
    otimizador = torch.optim.AdamW(treinaveis, lr=args.lr, weight_decay=0.01)
    passos = max(1, args.epocas * len(treino) // args.acumular)
    agenda = torch.optim.lr_scheduler.OneCycleLR(otimizador, args.lr, total_steps=passos, pct_start=0.06,
                                                 anneal_strategy='linear')
    inicio, passo, perdas, historico = time.perf_counter(), 0, [], []
    aluno.modelo.train()
    for epoca in range(args.epocas):
        for n, pool in enumerate(random.Random(epoca).sample(treino, len(treino))):
            textos = [c['texto'] for c in pool['cands']]
            alvo = torch.tensor([float(c['nota'] == 2) for c in pool['cands']], device='cuda')
            # The listwise loss needs every logit of the pool in one graph; gradient checkpointing keeps it in 6 GB.
            with meia_precisao():
                logits = torch.cat([aluno.logits([pool['frase']] * len(textos[i:i + args.lote]), textos[i:i + args.lote])
                                    for i in range(0, len(textos), args.lote)])
            perda = perda_pool(logits, alvo, args.peso_lista) / args.acumular
            perda.backward()
            perdas.append(perda.item() * args.acumular)
            if (n + 1) % args.acumular == 0:
                torch.nn.utils.clip_grad_norm_(treinaveis, 1.0)
                otimizador.step()
                otimizador.zero_grad(set_to_none=True)
                if passo < passos - 1:
                    agenda.step()
                passo += 1
                if passo % 50 == 0:
                    print(f'época {epoca} passo {passo}/{passos} perda {np.mean(perdas[-200:]):.4f} '
                          f'{(time.perf_counter() - inicio) / 60:.1f} min', flush=True)
            if time.perf_counter() - inicio > 60 * args.minutos:
                break
        historico.append({'epoca': epoca, **medir(valida, prever(aluno, valida, args.lote * 2))})
        print(json.dumps(historico[-1]), flush=True)
        if time.perf_counter() - inicio > 60 * args.minutos:
            break
    notas = prever(aluno, valida, args.lote * 2)
    x = np.concatenate(notas)
    y = np.concatenate([[c['nota'] == 2 for c in p['cands']] for p in valida]).astype(float)
    calibrador = IsotonicRegression(y_min=0, y_max=1, out_of_bounds='clip').fit(x, y)
    args.saida.mkdir(parents=True, exist_ok=True)
    aluno.salvar(args.saida)
    (args.saida / 'calibrador.json').write_text(json.dumps({
        'x': calibrador.X_thresholds_.tolist(), 'y': calibrador.y_thresholds_.tolist()}), encoding='utf-8')
    medidas = {'aluno': args.aluno, 'base': args.base or BASES[args.aluno], 'adaptador': str(args.adaptador), 'falas_treino': len(treino),
               'falas_validacao': len(valida), 'passos': passo, 'lr': args.lr, 'peso_lista': args.peso_lista,
               'treino_min': round((time.perf_counter() - inicio) / 60, 1),
               'vram_pico_gb': round(torch.cuda.max_memory_allocated() / 2 ** 30, 2), 'epocas': historico,
               'ece_validacao_bruto': bakeoff_juiz.ece(x, y)}
    (args.saida / 'treino.json').write_text(json.dumps(medidas, indent=1), encoding='utf-8')
    print(json.dumps(medidas, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
