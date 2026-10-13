# Orquestrador do copiloto (copiloto.api:app): sem acervo de desenvolvimento e sem juiz local.
# O juiz é o serviço de tools/juiz e cada conta traz o próprio acervo. Construir nesta pasta: docker build -t limmiar-copiloto .
# Em execução: COPILOTO_API_URL, COPILOTO_APP_ORIGEM, COPILOTO_JUIZ_URL, COPILOTO_JUIZ_CHAVE, COPILOTO_JUIZ_VERSAO.
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/app/hf
RUN useradd --system --create-home app && mkdir /app && chown app /app
WORKDIR /app
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY pyproject.toml ./
COPY src/copiloto/*.py src/copiloto/
RUN pip install -e .
COPY data/limiares-juiz-llm.json data/
COPY data/juiz-v2/registro.jsonl data/juiz-v2/
USER app
# Os modelos entram na imagem para o contêiner subir sem rede.
RUN python -c "from copiloto import embedder, traducao; embedder.carregar(); traducao.aquecer()"
ENV HF_HUB_OFFLINE=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/saude', timeout=4)"
# Um só worker: o acervo de cada conta vive na RAM do processo.
CMD ["uvicorn", "copiloto.api:app", "--host", "0.0.0.0", "--port", "8000"]
