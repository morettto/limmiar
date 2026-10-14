#!/usr/bin/env bash
# Constrói a imagem de uma versão do juiz, publica no registro da Fly e sobe a máquina com GPU.
# Da raiz do repositório, numa máquina com Docker e `flyctl auth login`:
#   HF_TOKEN=... VERSAO=v2 bash tools/juiz/deploy/publicar.sh
# A chave de API não passa por aqui: `flyctl secrets set VLLM_API_KEY=... -a $JUIZ_APP` (README, "Ambiente de teste").
set -euo pipefail

: "${HF_TOKEN:?token do Hugging Face de uma conta que aceitou a licença do Gemma}"
: "${VERSAO:?versão do juiz, igual à registrada em registro.jsonl (ex.: v2)}"
APP="${JUIZ_APP:-limmiar-juiz-teste}"
ADAPTADOR="${ADAPTADOR:-mvp-copiloto/data/juiz-v2/lora/$VERSAO}"
IMAGEM="registry.fly.io/$APP:$VERSAO"

flyctl auth docker
docker build -f tools/juiz/Dockerfile --secret id=hf,env=HF_TOKEN \
  --build-arg "ADAPTADOR=$ADAPTADOR" --build-arg "VERSAO=$VERSAO" -t "$IMAGEM" .
docker push "$IMAGEM"
flyctl deploy -c tools/juiz/deploy/fly.toml -a "$APP" --image "$IMAGEM"
