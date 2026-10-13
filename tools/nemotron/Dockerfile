# Imagem do serviço de transcrição: NeMo-Speech.cpp em versão fixa, do pacote oficial do release, com o SHA-256 conferido.
# CPU: docker build -t limmiar-nemotron:0.2.0-cpu tools/nemotron
# GPU: docker build --build-arg BACKEND=cuda -t limmiar-nemotron:0.2.0-cuda tools/nemotron   (rodar com --gpus all)
FROM ubuntu:24.04
ARG NEMO_SPEECH_VERSION=0.2.0
ARG BACKEND=cpu
# Não usa o instalador: ele roda o binário no fim, e o de CUDA só carrega com o driver da GPU, que não existe no build.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 libsentencepiece0 \
  && pacote="nemo-speech-${NEMO_SPEECH_VERSION}-linux-x86_64-${BACKEND}.tar.gz" \
  && base="https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v${NEMO_SPEECH_VERSION}" \
  && cd /tmp && curl -fsSLO --retry 3 "$base/$pacote" && curl -fsSLO --retry 3 "$base/$pacote.sha256" \
  && sha256sum -c "$pacote.sha256" \
  && mkdir /tmp/nemo && tar -xzf "$pacote" -C /tmp/nemo \
  && raiz=$(find /tmp/nemo -maxdepth 2 -type d -name bin -printf '%h\n' | head -1) && mv "$raiz" /opt/nemo-speech \
  && rm -rf /tmp/nemo "/tmp/$pacote" "/tmp/$pacote.sha256" /var/lib/apt/lists/*
ENV NEMO_SPEECH_MODEL_DIR=/models PATH=/opt/nemo-speech/bin:$PATH
ENTRYPOINT ["nemo-speech"]
