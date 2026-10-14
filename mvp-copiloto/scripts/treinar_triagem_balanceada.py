"""Triagem textual com peso por classe, calculado somente na partição de treino."""
from __future__ import annotations

import hashlib
import json
import math
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(RAIZ / 'src'), str(RAIZ / 'scripts')]

import treinar
from treinar_triagem_frase import exemplos
from copiloto import frase

NOME = 'triagem-frase-mmbert-r2'
CFG = {**treinar.CONFIG['mmbert-small'], 'lr': 3e-5, 'lote': 8, 'acumular': 2, 'epocas': 2,
       'perda': 'bce-pos-weight-por-particao', 'entrada': 'frase-atual-v1', 'seed': 13}


def pesos_positivos(falas: list[dict]) -> list[float]:
    pesos = []
    for campo in treinar.ROTULOS_TRIAGEM:
        alvos = [f[campo] for f in falas]
        if any(type(a) not in (int, float) or a not in (0, 1) for a in alvos):
            raise ValueError('Rótulo da triagem deve ser binário.')
        positivos = sum(alvos)
        if not 0 < positivos < len(falas):
            raise ValueError('Partição precisa de exemplos positivos e negativos por decisão.')
        pesos.append((len(falas) - positivos) / positivos)
    return pesos


def treinar_parte(falas: list[dict], saida: Path | None):
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding, Trainer, TrainingArguments, set_seed

    set_seed(CFG['seed'])
    origem = treinar.HF / CFG['hf']
    tok = AutoTokenizer.from_pretrained(origem, local_files_only=True)
    modelo = AutoModelForSequenceClassification.from_pretrained(origem, num_labels=3,
              ignore_mismatched_sizes=True, dtype=torch.float32, local_files_only=True)
    modelo.config.problem_type = 'multi_label_classification'
    treinar.reparar(modelo)
    for nome, parametro in modelo.named_parameters():
        if 'embed' in nome:
            parametro.requires_grad = False
    enc = tok([f['texto'] for f in falas], truncation=False)
    if max(map(len, enc['input_ids'])) > modelo.config.max_position_embeddings:
        raise ValueError('Frase e apoio excedem a capacidade da triagem; não truncar.')
    dados = [{**{k: v[i] for k, v in enc.items()}, 'labels': [f[c] for c in treinar.ROTULOS_TRIAGEM]}
             for i, f in enumerate(falas)]
    pesos = torch.tensor(pesos_positivos(falas), dtype=torch.float32)

    def perda(outputs, labels, num_items_in_batch=None):
        valor = torch.nn.functional.binary_cross_entropy_with_logits(outputs.logits.float(), labels.float(),
                  pos_weight=pesos.to(outputs.logits.device), reduction='sum')
        if not torch.isfinite(valor):
            raise ValueError('Perda não finita; não publicar pesos.')
        return valor / (labels.numel() if num_items_in_batch is None else num_items_in_batch)

    lotes = math.ceil(len(falas) / CFG['lote'])
    passos = CFG['epocas'] * math.ceil(lotes / CFG['acumular'])
    args = TrainingArguments(output_dir=str(treinar.MODELOS / NOME / 'trabalho'), use_cpu=True,
              per_device_train_batch_size=CFG['lote'], gradient_accumulation_steps=CFG['acumular'],
              num_train_epochs=CFG['epocas'], learning_rate=CFG['lr'], weight_decay=.01,
              warmup_steps=int(.06 * passos), max_grad_norm=1., optim='adamw_torch',
              gradient_checkpointing=True, gradient_checkpointing_kwargs={'use_reentrant': False},
              save_strategy='no', report_to='none', logging_steps=25, disable_tqdm=True,
              dataloader_num_workers=0, dataloader_pin_memory=False, seed=CFG['seed'])
    treinador = Trainer(model=modelo, args=args, data_collator=DataCollatorWithPadding(tok),
                        train_dataset=dados, processing_class=tok, compute_loss_func=perda)
    treinador.train()
    modelo.eval()
    if saida is not None:
        saida.mkdir(parents=True, exist_ok=True)
        modelo.save_pretrained(saida)
        tok.save_pretrained(saida)
    return tok, modelo


def main() -> None:
    import torch

    if torch.cuda.is_available():
        raise ValueError('Use CUDA_VISIBLE_DEVICES=-1; a GPU está dedicada ao juiz de fontes.')
    falas = exemplos()
    pasta = treinar.MODELOS / NOME
    pasta.mkdir(parents=True, exist_ok=True)
    manifesto = {'split': 'desenvolvimento-fora-da-parte', 'config': CFG,
                 'falas_sha256': hashlib.sha256(json.dumps(falas, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                 'formato_sha256': hashlib.sha256(Path(frase.__file__).read_bytes()).hexdigest(),
                 'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                 'treinador_sha256': hashlib.sha256(Path(treinar.__file__).read_bytes()).hexdigest()}
    caminho_oof = treinar.TREINO / f'oof-{NOME}.jsonl'
    caminho_manifesto = pasta / 'treino.json'
    if caminho_oof.exists() or (pasta / 'torch').exists():
        if not caminho_manifesto.exists() or json.loads(caminho_manifesto.read_text(encoding='utf-8')) != manifesto:
            raise ValueError('Dados ou treino mudaram; preserve o candidato e use outra versão.')
    caminho_manifesto.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2), encoding='utf-8')
    linhas = treinar.ler_jsonl(caminho_oof)
    if len({l['id'] for l in linhas}) != len(linhas):
        raise ValueError('Predições duplicadas; não retomar.')
    feitas = {l['parte'] for l in linhas}
    for k in feitas:
        if {l['id'] for l in linhas if l['parte'] == k} != {f['id'] for f in falas if f['parte'] == k}:
            raise ValueError('Partição incompleta; não misturar predições.')
    for k in range(treinar.PARTES):
        if k in feitas:
            continue
        inicio = time.perf_counter()
        treino = [f for f in falas if f['parte'] != k]
        valida = [f for f in falas if f['parte'] == k]
        tok, modelo = treinar_parte(treino, None)
        notas = treinar._pontuar(tok, modelo, valida, par=False, lote=8)
        linhas.extend({'id': f['id'], 'grupo': f['grupo'], 'parte': k,
                       'notas': dict(zip(treinar.ROTULOS_TRIAGEM, nota, strict=True)),
                       'alvo': {c: f[c] for c in treinar.ROTULOS_TRIAGEM}}
                      for f, nota in zip(valida, notas, strict=True))
        treinar.gravar_jsonl(caminho_oof, linhas)
        print(f'Parte {k}: {len(valida)} frases, {time.perf_counter() - inicio:.1f}s.', flush=True)
        del modelo
    treinar_parte(falas, pasta / 'torch')
    print(f'{len(falas)} frases; triagem balanceada concluída sem usar teste.', flush=True)


if __name__ == '__main__':
    main()
