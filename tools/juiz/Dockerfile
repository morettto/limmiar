# syntax=docker/dockerfile:1
# Juiz do copiloto: Gemma 4 E4B + adaptador LoRA atrás da API da OpenAI (vLLM). Uma imagem = uma versão do juiz.
# O Gemma tem licença com aceite, então o token do Hugging Face entra como secret do build e não fica na imagem. Da raiz:
#   docker build -f tools/juiz/Dockerfile --secret id=hf,env=HF_TOKEN --build-arg ADAPTADOR=mvp-copiloto/data/juiz-v2/lora/v2 --build-arg VERSAO=v2 -t limmiar-juiz:v2 .
FROM vllm/vllm-openai:v0.31.0
ARG ADAPTADOR
ARG VERSAO
RUN test -n "$ADAPTADOR" && test -n "$VERSAO"
RUN --mount=type=secret,id=hf python3 -c "from huggingface_hub import snapshot_download; snapshot_download('google/gemma-4-E4B-it', token=open('/run/secrets/hf').read().strip())"
COPY ${ADAPTADOR} /adaptador
ENV HF_HUB_OFFLINE=1 LIMMIAR_JUIZ_VERSAO=${VERSAO}
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
# A chave de API vem de VLLM_API_KEY na execução; sem ela o contêiner não sobe, em vez de servir aberto.
ENTRYPOINT ["sh", "-c", "test -n \"$VLLM_API_KEY\" || { echo 'VLLM_API_KEY ausente' >&2; exit 1; }; exec vllm serve google/gemma-4-E4B-it --served-model-name base --enable-lora --lora-modules juiz=/adaptador --max-lora-rank 16 --max-model-len 3072 --enable-prefix-caching --no-enable-log-requests --port 8000 \"$@\"", "juiz"]
CMD ["--gpu-memory-utilization", "0.90"]
