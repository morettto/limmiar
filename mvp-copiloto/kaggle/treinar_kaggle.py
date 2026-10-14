import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

subprocess.run([sys.executable, "-m", "pip", "install", "-q", "peft"], check=False)

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

ENTRADA = next(Path("/kaggle/input").rglob("pares.jsonl"))
SAIDA = Path("/kaggle/working")
MAX_TOKENS = 256
MAX_CARACTERES_TRECHO = 900
LORA_QWEN = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
CONFIG = {
    "gte-r5k": {"hf": "Alibaba-NLP/gte-multilingual-reranker-base", "lr": 2e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "bge-m3-r5k": {"hf": "BAAI/bge-reranker-v2-m3", "lr": 1e-5, "lote": 4, "acumular": 8, "epocas": 2, "congelar": True},
    "qwen06-r5k": {"hf": "tomaarsen/Qwen3-Reranker-0.6B-seq-cls", "lr": 1e-4, "lote": 4, "acumular": 8, "epocas": 1, "formato": "qwen", "lora": LORA_QWEN},
    "mxbai15-r5k": {"hf": "mixedbread-ai/mxbai-rerank-large-v2", "lr": 1e-4, "lote": 4, "acumular": 8, "epocas": 1, "formato": "qwen", "lora": LORA_QWEN},
}
PREFIXO_QWEN = ("<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. "
                "Note that the answer can only be \"yes\" or \"no\".<|im_end|>\n<|im_start|>user\n")
SUFIXO_QWEN = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
INSTRUCAO_QWEN = "Given a patient's utterance in a therapy session, judge whether the passage describes the same clinical phenomenon the patient expresses"


def formato_qwen(consulta, trecho):
    return f"{PREFIXO_QWEN}<Instruct>: {INSTRUCAO_QWEN}\n<Query>: {consulta}\n<Document>: {trecho[:MAX_CARACTERES_TRECHO]}{SUFIXO_QWEN}"


def reparar(modelo):
    for mod in modelo.modules():
        if mod.__class__.__name__.endswith("Embeddings") and isinstance(getattr(mod, "position_ids", None), torch.Tensor):
            mod.position_ids = torch.arange(mod.position_ids.numel(), device=mod.position_ids.device)


def codificar(tok, fatia, formato):
    if formato == "qwen":
        return tok([formato_qwen(e["q"], e["trecho"]) for e in fatia], padding=True, truncation=True, max_length=512, return_tensors="pt")
    return tok([e["q"] for e in fatia], [e["trecho"] for e in fatia], truncation="only_second", max_length=MAX_TOKENS,
               padding=True, return_tensors="pt")


def treinar_um(cfg, exemplos, saida=None):
    torch.manual_seed(13)
    tok = AutoTokenizer.from_pretrained(cfg["hf"], trust_remote_code=True)
    modelo = AutoModelForSequenceClassification.from_pretrained(cfg["hf"], num_labels=1, trust_remote_code=True,
                                                                ignore_mismatched_sizes=True, torch_dtype=torch.float32)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    modelo.config.pad_token_id = tok.pad_token_id
    reparar(modelo)
    if cfg.get("lora"):
        from peft import LoraConfig, TaskType, get_peft_model

        modelo = get_peft_model(modelo, LoraConfig(task_type=TaskType.SEQ_CLS, r=16, lora_alpha=32, lora_dropout=0.05,
                                                   target_modules=cfg["lora"]))
    elif cfg.get("congelar"):
        for nome, p in modelo.named_parameters():
            if "embed" in nome:
                p.requires_grad = False
    modelo.to("cuda")
    try:
        modelo.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        if cfg.get("lora"):
            modelo.enable_input_require_grads()
    except (ValueError, AttributeError, TypeError):
        pass
    meia = torch.cuda.get_device_capability()[0] >= 7
    escala = torch.amp.GradScaler("cuda", enabled=meia)
    lote, acumular, epocas = cfg["lote"], cfg["acumular"], cfg["epocas"]
    treinaveis = [p for p in modelo.parameters() if p.requires_grad]
    otim = torch.optim.AdamW(treinaveis, lr=cfg["lr"], weight_decay=0.01)
    passos = epocas * ((len(exemplos) + lote - 1) // lote) // acumular
    agenda = get_linear_schedule_with_warmup(otim, int(0.06 * passos), max(1, passos))
    gerador = torch.Generator().manual_seed(13)
    modelo.train()
    for epoca in range(epocas):
        ordem = torch.randperm(len(exemplos), generator=gerador).tolist()
        total = 0.0
        for k, i in enumerate(range(0, len(ordem), lote)):
            fatia = [exemplos[j] for j in ordem[i:i + lote]]
            enc = codificar(tok, fatia, cfg.get("formato")).to("cuda")
            alvo = torch.tensor([[e["alvo"]] for e in fatia], dtype=torch.float32, device="cuda")
            with torch.autocast("cuda", dtype=torch.float16, enabled=meia):
                logits = modelo(**enc).logits.float()
            perda = torch.nn.functional.binary_cross_entropy_with_logits(logits, alvo) / acumular
            escala.scale(perda).backward()
            total += perda.item() * acumular
            if (k + 1) % acumular == 0:
                escala.unscale_(otim)
                torch.nn.utils.clip_grad_norm_(treinaveis, 1.0)
                escala.step(otim)
                escala.update()
                agenda.step()
                otim.zero_grad()
        print(f"    epoca {epoca + 1}/{epocas} perda {total / max(1, k + 1):.4f}", flush=True)
    modelo.eval()
    if cfg.get("lora"):
        modelo = modelo.merge_and_unload()
    if saida:
        saida.mkdir(parents=True, exist_ok=True)
        if sum(p.numel() for p in modelo.parameters()) > 300_000_000:
            modelo = modelo.half()
        modelo.save_pretrained(saida, safe_serialization=True)
        tok.save_pretrained(saida)
        if cfg.get("formato"):
            (saida / "formato.txt").write_text(cfg["formato"], encoding="utf-8")
    return tok, modelo


def pontuar(tok, modelo, exemplos, formato, lote=32):
    notas = []
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16, enabled=torch.cuda.get_device_capability()[0] >= 7):
        for i in range(0, len(exemplos), lote):
            enc = codificar(tok, exemplos[i:i + lote], formato).to("cuda")
            notas += torch.sigmoid(modelo(**enc).logits.float()).squeeze(-1).tolist()
    return notas


def main():
    cfg = CONFIG[MODELO]
    pares = [json.loads(l) for l in ENTRADA.read_text(encoding="utf-8").splitlines() if l.strip()]
    exemplos = [p for p in pares if p["pesado"]] if cfg.get("lora") else pares
    destino = SAIDA / MODELO
    destino.mkdir(parents=True, exist_ok=True)
    print(f"{MODELO}: {len(exemplos)} exemplos, {sum(e['alvo'] >= 0.5 for e in exemplos)} com alvo >= 0,5, GPU {torch.cuda.get_device_name()}", flush=True)
    registo = {"hf": cfg["hf"], "exemplos": len(exemplos), "config": cfg, "max_tokens": MAX_TOKENS, "partes": {}}
    for k in PARTES_A_CORRER:
        inicio = time.perf_counter()
        tok, modelo = treinar_um(cfg, [e for e in exemplos if e["parte"] != k])
        valida = [e for e in pares if e["parte"] == k]
        notas = pontuar(tok, modelo, valida, cfg.get("formato"))
        with (destino / f"oof-{MODELO}.jsonl").open("a", encoding="utf-8") as saida:
            for e, n in zip(valida, notas):
                saida.write(json.dumps({"id": e["id"], "arquivo": e["arquivo"], "pagina": e["pagina"], "paragrafo": e["paragrafo"],
                                        "parte": k, "notas": {"alvo": n}, "alvo": {"alvo": e["alvo"]}}) + "\n")
        registo["partes"][k] = round(time.perf_counter() - inicio)
        print(f"  parte {k}: {len(valida)} validacao, {registo['partes'][k]} s", flush=True)
        del modelo
        torch.cuda.empty_cache()
    if FINAL:
        inicio = time.perf_counter()
        torch.cuda.reset_peak_memory_stats()
        treinar_um(cfg, exemplos, destino / "torch")
        registo["segundos_modelo_final"] = round(time.perf_counter() - inicio)
        registo["pico_vram_treino_gib"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
    registo["gpu"] = torch.cuda.get_device_name()
    registo["sha_pares"] = hashlib.sha256(ENTRADA.read_bytes()).hexdigest()
    (destino / "treino.json").write_text(json.dumps(registo, indent=2), encoding="utf-8")


main()
