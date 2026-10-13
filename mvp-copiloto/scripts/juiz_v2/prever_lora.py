"""Prevê um arquivo com o modelo base e, se dado, um adaptador. Uso: prever_lora.py MODELO ADAPTADOR|- ENTRADA.jsonl SAIDA.jsonl"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from treinar_lora import logits_sn, prompt


def main() -> None:
    modelo, adaptador, entrada, saida = sys.argv[1:5]
    rows = [json.loads(l) for l in Path(entrada).read_text(encoding="utf-8").splitlines() if l.strip()]
    tok = AutoTokenizer.from_pretrained(modelo, padding_side="left")
    ids = [tok.encode("no", add_special_tokens=False)[0], tok.encode("yes", add_special_tokens=False)[0]]
    model = AutoModelForCausalLM.from_pretrained(modelo, dtype=torch.bfloat16).cuda()
    if adaptador != "-":
        model = PeftModel.from_pretrained(model, adaptador)
    model.eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(rows), 16):
            lote = rows[i:i + 16]
            p = torch.softmax(logits_sn(model, tok, [prompt(tok, r) for r in lote], ids), dim=-1)[:, 1].tolist()
            out += [{**r, "prob": x} for r, x in zip(lote, p, strict=True)]
    Path(saida).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    print(f"{len(out)} previsões", flush=True)


if __name__ == "__main__":
    main()
