import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@limmiar/i18n': fileURLToPath(new URL('../../packages/i18n/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // No DOM needed — only the pure src/lib/**/*.ts helpers are under test.
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      // Discover every source file under src/lib (not just ones a test
      // happens to import), so a new file added without a test fails the
      // gate instead of being silently absent from the report. Astro
      // components/pages/layouts are exercised via Playwright E2E instead,
      // not Vitest — Astro's build context (astro:i18n, etc.) isn't
      // available under plain Vitest, so only src/lib/**/*.ts is in scope.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
