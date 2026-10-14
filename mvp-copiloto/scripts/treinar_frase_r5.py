"""R4 com peso 8 nos contrastes de fonte, agora quatro vezes mais numerosos."""
from __future__ import annotations

import hashlib
from pathlib import Path

import treinar


def main():
    nome = 'qwen-frase-r5'
    treinar.CONFIG[nome] = {**treinar.CONFIG['qwen-frase-r2'], 'epocas': 2, 'lr': 2e-5,
                           'peso_contraste_fonte': 8., 'semantica_v3': True,
                           'candidato_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    treinar.treinar(nome)


if __name__ == '__main__':
    main()
