#!/usr/bin/env bash
# Uso: professor.sh MODELO.gguf LOG. Sobe o professor em 127.0.0.1:8200 (PROFESSOR_URL padrão) e espera ficar pronto.
# --swa-full keeps Gemma's sliding-window KV whole, so a passage prefix is reused; -cram 0 keeps the prompt cache off host RAM.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/../../.." && pwd)"
"$raiz/.local/llamacpp/bin12/llama-server.exe" -m "$1" -ngl 99 -c 8192 -np 4 -fa "${FA:-on}" -rea off --swa-full -cram 0 \
  --host 127.0.0.1 --port 8200 --alias professor > "$2" 2>&1 &
servidor=$!
until curl -sf localhost:8200/health > /dev/null; do
  kill -0 "$servidor" 2> /dev/null || { tail -5 "$2"; exit 1; }
  sleep 2
done
echo "professor pronto: $1"
