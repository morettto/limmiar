import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      // main.ts só liga as peças ao ambiente; o worker roda com o modelo real, coberto por titanet.integration.test.ts
      // quando o modelo existe.
      exclude: ['src/**/*.test.ts', 'src/test-support/**', 'src/main.ts', 'src/extrator.worker.ts', 'src/trabalhador-titanet.ts'],
      thresholds: { perFile: true, statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})
