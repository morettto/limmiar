"""LoRA do juiz sim/não. Uso: treinar_lora.py MODELO DADOS.jsonl FOLD NFOLDS SAIDA [epocas]
FOLD>=0: treina fora da obra-fold e prevê nela; FOLD=-1: treina tudo e salva adaptador; FOLD=-2: só prevê com o modelo base."""
from __future__ import annotations

import hashlib
import json
import random
import sys
import time
from pathlib import Path

import torch
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).parent))
from julgar_llm import RUBRICA, mensagem

MAX_TRECHO = 1600
LOTE, ACUM, LR = 4, 4, 1e-4


def dobra(r: dict, n: int) -> int:
    return int(hashlib.sha256(r["arquivo"].encode()).hexdigest(), 16) % n


def prompt(tok, r: dict) -> str:
    r = {**r, "trecho": r["trecho"][:MAX_TRECHO]}
    return tok.apply_chat_template([{"role": "system", "content": RUBRICA}, {"role": "user", "content": mensagem(r)}],
                                   tokenize=False, add_generation_prompt=True)


def logits_sn(model, tok, textos: list[str], ids: list[int]) -> torch.Tensor:
    enc = tok(textos, return_tensors="pt", padding=True, add_special_tokens=False).to("cuda")
    saida = model(**enc, logits_to_keep=1).logits[:, -1, :]
    return saida[:, ids].float()


def main() -> None:
    modelo, dados, fold, n, saida = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), Path(sys.argv[5])
    epocas = int(sys.argv[6]) if len(sys.argv) > 6 else 2
    rows = [json.loads(l) for l in Path(dados).read_text(encoding="utf-8").splitlines() if l.strip()]
    treino = [r for r in rows if fold < 0 or dobra(r, n) != fold] if fold != -2 else []
    teste = [r for r in rows if dobra(r, n) == fold] if fold >= 0 else (rows if fold == -2 else [])
    tok = AutoTokenizer.from_pretrained(modelo, padding_side="left")
    ids = [tok.encode("no", add_special_tokens=False)[0], tok.encode("yes", add_special_tokens=False)[0]]
    model = AutoModelForCausalLM.from_pretrained(modelo, dtype=torch.bfloat16).cuda()
    if fold != -2:
        cfg = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
                         target_modules=r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)")
        model = get_peft_model(model, cfg)
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model.enable_input_require_grads()
        model.print_trainable_parameters()
        opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR, weight_decay=0.0)
        passos = epocas * len(treino) // (LOTE * ACUM)
        sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 10) * max(0.05, 1 - s / max(1, passos)))
        random.seed(3)
        model.train()
        inicio, passo = time.perf_counter(), 0
        for ep in range(epocas):
            random.shuffle(treino)
            for i in range(0, len(treino) - LOTE + 1, LOTE):
                lote = treino[i:i + LOTE]
                alvo = torch.tensor([r.get("alvo_suave", r["alvo"]) for r in lote], dtype=torch.float32, device="cuda")
                peso = torch.tensor([2.0 if r["origem"] in ("dificil", "rotulo_usuario") else 1.0 for r in lote], device="cuda")
                lg = logits_sn(model, tok, [prompt(tok, r) for r in lote], ids)
                perda = (torch.nn.functional.binary_cross_entropy_with_logits(lg[:, 1] - lg[:, 0], alvo, reduction="none") * peso).mean() / ACUM
                perda.backward()
                if (i // LOTE + 1) % ACUM == 0:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    opt.step(); sched.step(); opt.zero_grad(); passo += 1
                    if passo % 10 == 0:
                        print(f"época {ep + 1} passo {passo}/{passos} perda {perda.item() * ACUM:.3f} {time.perf_counter() - inicio:.0f}s", flush=True)
        model.eval()
        if fold < 0:
            model.save_pretrained(saida)
    model.eval()
    if teste:
        out = []
        with torch.no_grad():
            for i in range(0, len(teste), 16):
                lote = teste[i:i + 16]
                p = torch.softmax(logits_sn(model, tok, [prompt(tok, r) for r in lote], ids), dim=-1)[:, 1].tolist()
                out += [{**r, "prob": x} for r, x in zip(lote, p, strict=True)]
        Path(str(saida) + ".previsoes.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
        print(f"{len(out)} previsões", flush=True)


if __name__ == "__main__":
    main()
