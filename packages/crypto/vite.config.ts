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
      // index.ts is a pure re-export barrel with no branching logic of its
      // own to assert on — same "don't test the entry point" exclusion
      // apps/app applies to main.tsx. benchmark.ts (and any scripts/ dir) is
      // a manual calibration tool run by a human against real hardware, not
      // gated logic — same rationale as index.ts, just a different reason.
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
