"""Baixa o codificador da busca (bge-m3 em ONNX) na revisão fixada em copiloto.embedder, para COPILOTO_EMBEDDER_DIR."""
from __future__ import annotations

import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from copiloto import embedder  # noqa: E402

for arquivo in embedder.arquivos():
    print(hf_hub_download(embedder.REPO, arquivo.relative_to(embedder.PASTA).as_posix(), revision=embedder.REVISAO,
                          local_dir=embedder.PASTA), flush=True)
