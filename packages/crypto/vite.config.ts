import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      // Discover every source file (not just ones a test happens to import),
      // so a new file added without a test fails the gate instead of being
      // silently absent from the report.
      include: ['src/**/*.ts'],
      // index.ts is a re-export barrel with no logic to assert on (same as
      // apps/app's main.tsx); benchmark.ts and scripts/ are manual calibration
      // tools run against real hardware, not gated logic.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/benchmark.ts'],
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
