import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Playwright CT owns src/**/*.spec.tsx (visual regression); keep Vitest
    // scoped to unit specs under src/**/*.test.tsx — same split apps/app
    // uses between e2e/** and src/**.
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom's CSS deps ship ESM-only files loaded via require(); the local
    // Node (22.11) needs this flag explicitly (it's unflagged from 22.12+).
    execArgv: ['--experimental-require-module'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/index.ts', 'src/test-support/**'],
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
