"""Candidato R3 com contrastes de fonte revisados e ampliados (semântica v3)."""
from __future__ import annotations

import hashlib
from pathlib import Path

import treinar


def main():
    nome = 'qwen-frase-r4'
    treinar.CONFIG[nome] = {**treinar.CONFIG['qwen-frase-r2'], 'epocas': 2, 'lr': 2e-5,
                           'peso_contraste_fonte': 24., 'semantica_v3': True,
                           'candidato_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    treinar.treinar(nome)


if __name__ == '__main__':
    main()
