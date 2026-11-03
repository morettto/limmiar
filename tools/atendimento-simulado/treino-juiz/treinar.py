"""Treina um aluno nos pares verificados e calibra a nota em artigos de validação nunca vistos no treino.

Uso: treinar.py --aluno gte|qwen --pares ARQ --saida DIR [--base REPO] [--minutos 30] [--lote 8] [--epocas 1].
gte: LoRA no cross-encoder gte-multilingual-reranker-base (cabeça treinada inteira), BCE contra a nota do professor.
qwen: LoRA no Qwen3-Reranker-0.6B, logit yes-no do mesmo prompt do bakeoff_juiz.py, BCE contra a nota do professor;
--base aceita o .gguf local (dequantizado ao carregar), que poupa baixar 1,2 GB de pesos.
A pasta de saída carrega no bakeoff_juiz.py (--alunos DIR) e traz calibrador.json (isotônico) e treino.json (medidas).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import zlib
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'gold'))

import bakeoff_juiz  # noqa: E402
from copiloto import aluno  # noqa: E402

FRACAO_VALIDACAO = 0.15
BASES = {'gte': 'Alibaba-NLP/gte-multilingual-reranker-base', 'qwen': 'Qwen/Qwen3-Reranker-0.6B'}


def validacao(pmcid: str) -> bool:
    return zlib.crc32(pmcid.encode()) % 1000 < FRACAO_VALIDACAO * 1000


def dividir(pares: list[dict]) -> tuple[list[dict], list[dict]]:
    """By article: a pair whose utterance and passage come from different sides of the split is dropped."""
    treino, valida = [], []
    for par in pares:
        lados = {validacao(p) for p in (par['pmcid_trecho'], par['pmcid_frase']) if p}
        if lados == {False}:
            treino.append(par)
        elif lados == {True}:
            valida.append(par)
    return treino, valida


class Gte:
    def __init__(self, base: str) -> None:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        from peft import LoraConfig, get_peft_model

        self.tok = AutoTokenizer.from_pretrained(base, trust_remote_code=True)
        modelo = AutoModelForSequenceClassification.from_pretrained(base, trust_remote_code=True, dtype=torch.float32)
        aluno.reparar(modelo)
        modelo.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
        # LoRA, not a full copy: a 600 MB checkpoint does not fit the free disk, and AdamW over 306M weights not in 6 GB.
        self.modelo = get_peft_model(modelo, LoraConfig(
            r=32, lora_alpha=64, lora_dropout=0.05, target_modules=['qkv_proj', 'o_proj', 'up_gate_proj', 'down_proj'],
            modules_to_save=['classifier', 'pooler'])).cuda()

    def logits(self, frases: list[str], trechos: list[str]) -> torch.Tensor:
        enc = self.tok(frases, trechos, padding=True, truncation=True, max_length=aluno.MAX_TOKENS, return_tensors='pt')
        return self.modelo(**enc.to('cuda')).logits[:, 0].float()

    def salvar(self, pasta: Path) -> None:
        self.modelo.save_pretrained(pasta)
        self.tok.save_pretrained(pasta)


class Qwen:
    def __init__(self, base: str) -> None:
        from peft import LoraConfig, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.base = base
        fonte, extra = bakeoff_juiz.fonte_hf(base)
        self.tok = AutoTokenizer.from_pretrained(fonte, padding_side='left', **extra)
        modelo = AutoModelForCausalLM.from_pretrained(fonte, dtype=torch.float32, **extra)
        self.ids = [self.tok.convert_tokens_to_ids('no'), self.tok.convert_tokens_to_ids('yes')]
        self.modelo = get_peft_model(modelo, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules=[
            'q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])).cuda()
        self.modelo.base_model.model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})

    def logits(self, frases: list[str], trechos: list[str]) -> torch.Tensor:
        entradas = [f'{bakeoff_juiz.PREFIXO_QWEN}<Instruct>: {bakeoff_juiz.INSTRUCAO_QWEN}\n<Query>: {f}\n<Document>: {t}'
                    f'{bakeoff_juiz.SUFIXO_QWEN}' for f, t in zip(frases, trechos)]
        enc = self.tok(entradas, padding=True, return_tensors='pt').to('cuda')
        # Only the yes/no rows of the head matter, so the 151k-way projection is skipped.
        oculto = self.modelo.base_model.model.model(**enc).last_hidden_state[:, -1]
        pesos = self.modelo.base_model.model.lm_head.weight[self.ids]
        nao, sim = (oculto @ pesos.T).float().unbind(-1)
        return sim - nao

    def salvar(self, pasta: Path) -> None:
        self.modelo.save_pretrained(pasta)
        self.tok.save_pretrained(pasta)
        # peft records the folder a GGUF was read from; bakeoff_juiz needs the file itself to rebuild the base.
        config = json.loads((pasta / 'adapter_config.json').read_text(encoding='utf-8'))
        config['base_model_name_or_path'] = str(Path(self.base).resolve()) if self.base.endswith('.gguf') else self.base
        (pasta / 'adapter_config.json').write_text(json.dumps(config, indent=1), encoding='utf-8')


def meia_precisao() -> torch.autocast:
    # bf16 only on Ampere+; a GTX 1660 runs fp16 GEMMs at 0.58 TFLOPS against 4.8 in fp32 (measured), so it stays fp32.
    return torch.autocast('cuda', dtype=torch.bfloat16, enabled=torch.cuda.get_device_capability()[0] >= 8)


def prever(aluno, pares: list[dict], lote: int) -> np.ndarray:
    aluno.modelo.eval()
    notas = []
    with torch.inference_mode(), meia_precisao():
        for i in range(0, len(pares), lote):
            fatia = pares[i:i + lote]
            notas += aluno.logits([p['frase'] for p in fatia], [p['trecho'] for p in fatia]).sigmoid().tolist()
    aluno.modelo.train()
    return np.array(notas)


def main(argv: list[str]) -> None:
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import roc_auc_score

    parser = argparse.ArgumentParser()
    parser.add_argument('--aluno', choices=('gte', 'qwen'), required=True)
    parser.add_argument('--pares', type=Path, required=True)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--base')
    parser.add_argument('--minutos', type=float, default=30)
    parser.add_argument('--lote', type=int, default=8)
    parser.add_argument('--acumular', type=int, default=2)
    parser.add_argument('--epocas', type=int, default=1)
    parser.add_argument('--lr', type=float)
    args = parser.parse_args(argv)
    torch.manual_seed(0)
    pares = [json.loads(l) for l in args.pares.read_text(encoding='utf-8').splitlines() if l.strip()]
    treino, valida = dividir(pares)
    print(f'{len(treino)} pares de treino, {len(valida)} de validação', flush=True)
    aluno = (Gte if args.aluno == 'gte' else Qwen)(args.base or BASES[args.aluno])
    treinaveis = [p for p in aluno.modelo.parameters() if p.requires_grad]
    lr = args.lr or 2e-4
    otimizador = torch.optim.AdamW(treinaveis, lr=lr, weight_decay=0.01)
    passos = args.epocas * len(treino) // (args.lote * args.acumular)
    agenda = torch.optim.lr_scheduler.OneCycleLR(otimizador, lr, total_steps=max(passos, 1), pct_start=0.06,
                                                 anneal_strategy='linear')
    perda_bce = torch.nn.BCEWithLogitsLoss()
    inicio, passo, vistos, perdas = time.perf_counter(), 0, 0, []
    aluno.modelo.train()
    parar = False
    for epoca in range(args.epocas):
        ordem = random.Random(epoca).sample(treino, len(treino))
        for i in range(0, len(ordem) - args.lote + 1, args.lote):
            fatia = ordem[i:i + args.lote]
            with meia_precisao():
                logits = aluno.logits([p['frase'] for p in fatia], [p['trecho'] for p in fatia])
            alvo = torch.tensor([p['nota_professor'] for p in fatia], device='cuda')
            perda = perda_bce(logits, alvo) / args.acumular
            perda.backward()
            perdas.append(perda.item() * args.acumular)
            vistos += len(fatia)
            if (i // args.lote + 1) % args.acumular == 0:
                torch.nn.utils.clip_grad_norm_(treinaveis, 1.0)
                otimizador.step()
                otimizador.zero_grad(set_to_none=True)
                if passo < passos - 1:
                    agenda.step()
                passo += 1
                if passo % 50 == 0:
                    gasto = time.perf_counter() - inicio
                    print(f'passo {passo}/{passos} perda {np.mean(perdas[-100:]):.4f} {vistos / gasto:.1f} pares/s '
                          f'vram {torch.cuda.max_memory_allocated() / 2 ** 30:.2f} GB', flush=True)
                if time.perf_counter() - inicio > 60 * args.minutos:
                    parar = True
                    break
        if parar:
            break
    treino_s = time.perf_counter() - inicio
    notas = prever(aluno, valida, args.lote * 2)
    y = np.array([p['rotulo'] for p in valida])
    calibrador = IsotonicRegression(y_min=0, y_max=1, out_of_bounds='clip').fit(notas, y)
    args.saida.mkdir(parents=True, exist_ok=True)
    aluno.salvar(args.saida)
    (args.saida / 'calibrador.json').write_text(json.dumps({
        'x': calibrador.X_thresholds_.tolist(), 'y': calibrador.y_thresholds_.tolist()}), encoding='utf-8')
    medidas = {'aluno': args.aluno, 'base': args.base or BASES[args.aluno], 'pares_treino': len(treino),
               'pares_validacao': len(valida), 'pares_vistos': vistos, 'passos': passo, 'passos_previstos': passos,
               'treino_s': round(treino_s, 1), 'pares_por_s': round(vistos / treino_s, 2), 'lr': lr,
               'vram_pico_gb': round(torch.cuda.max_memory_allocated() / 2 ** 30, 2),
               'auroc_validacao': round(float(roc_auc_score(y, notas)), 4) if 0 < y.sum() < len(y) else None,
               'ece_validacao_bruto': bakeoff_juiz.ece(notas, y),
               'perda_final': round(float(np.mean(perdas[-100:])), 4)}
    (args.saida / 'treino.json').write_text(json.dumps(medidas, indent=1), encoding='utf-8')
    print(json.dumps(medidas, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
