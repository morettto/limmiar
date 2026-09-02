import { defineConfig } from 'vitest/config'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'

// Config separada da de vite.config.ts: os testes Pact levantam um mock-server por interação e
// atravessam o catálogo real, logo são contrato, não unidade, e nunca correm sob a instrumentação
// do `test:unit`. Precisa das mesmas peças lingui() + babel-macro para resolver os macros.
export default defineConfig({
  plugins: [lingui(), babel({ presets: [linguiTransformerBabelPreset()] })],
  test: {
    environment: 'jsdom',
    include: ['src/shared/api/client.pact.test.ts', 'src/entities/account/api.pact.test.ts'],
    execArgv: ['--experimental-require-module'],
  },
})
