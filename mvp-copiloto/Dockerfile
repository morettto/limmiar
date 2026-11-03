# Copiloto (copiloto.api:app): busca e juiz pequeno no mesmo processo, na CPU, em ONNX Runtime.
# Construir nesta pasta, com modelos/juiz-pequeno e modelos/bge-m3 (scripts/baixar_modelos.py) presentes:
# docker build -t limmiar-copiloto .
# Em execução: COPILOTO_API_URL, COPILOTO_APP_ORIGEM e, se preciso, COPILOTO_JUIZ_THREADS e COPILOTO_EMBEDDER_THREADS.
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN useradd --system --create-home app && mkdir /app && chown app /app
WORKDIR /app
COPY pyproject.toml ./
COPY src/copiloto/*.py src/copiloto/
RUN pip install -e .
COPY data/juiz-pequeno.json data/risco-cabeca.json data/
COPY data/juiz-v2/registro.jsonl data/juiz-v2/
COPY modelos/juiz-pequeno/tokenizer.json modelos/juiz-pequeno/
COPY modelos/juiz-pequeno/onnx/model_gather.onnx modelos/juiz-pequeno/onnx/
COPY modelos/bge-m3/tokenizer.json modelos/bge-m3/
COPY modelos/bge-m3/onnx/sentence_transformers_int8.onnx modelos/bge-m3/onnx/
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/saude', timeout=4)"
# Um só worker: o acervo de cada conta vive na RAM do processo.
CMD ["uvicorn", "copiloto.api:app", "--host", "0.0.0.0", "--port", "8000"]
