# syntax=docker/dockerfile:1
# Gateway de fala: fica entre o navegador e o NeMo-Speech, sem estado entre sessões (README.md).
# Construir da raiz do repositório: docker build -f apps/gateway-fala/Dockerfile -t limmiar-gateway-fala .
# Em execução: NEMOTRON_URL, NEMOTRON_CHAVE, GATEWAY_FALA_CHAVE, GATEWAY_FALA_PORTA, GATEWAY_FALA_THREADS.
FROM node:24-bookworm-slim
ENV NODE_ENV=production GATEWAY_FALA_HOST=0.0.0.0 GATEWAY_FALA_MODELO=/models/titanet.onnx
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/gateway-fala/package.json apps/gateway-fala/
COPY packages/diarization/package.json packages/diarization/
RUN pnpm install --frozen-lockfile --prod --filter "gateway-fala..."
COPY packages/diarization/src packages/diarization/src
COPY apps/gateway-fala/src apps/gateway-fala/src
# O mesmo TitaNet do cadastro de voz no aparelho (tools/voice-identity/setup.mjs): o hash garante que é o mesmo arquivo.
ADD --checksum=sha256:d51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx /models/titanet.onnx
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.GATEWAY_FALA_PORTA ?? 8090) + '/saude').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/gateway-fala/src/main.ts"]
