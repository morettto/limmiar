"""Candidato de desenvolvimento após os contrastes fora da partição do R2."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import treinar


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--parte0', action='store_true')
    args = parser.parse_args()
    nome = 'qwen-frase-r3'
    treinar.CONFIG[nome] = {**treinar.CONFIG['qwen-frase-r2'], 'epocas': 2, 'lr': 2e-5,
                           'peso_contraste_fonte': 24.,
                           'candidato_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    treinar.treinar(nome, final=not args.parte0, partes=[0] if args.parte0 else None)


if __name__ == '__main__':
    main()
