// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  // pnpm's non-flat node_modules means Stryker's automatic plugin resolution
  // (globbing "@stryker-mutator/*" in node_modules) can miss the runner;
  // list it explicitly so it's always found regardless of hoisting.
  plugins: ['@stryker-mutator/vitest-runner'],
  // main.tsx is the bootstrap/entry point (createRoot + render), excluded
  // from coverage in vite.config.ts for the same reason: no branching logic
  // of its own to assert on. Test files are mutated targets' specs, not
  // targets themselves.
  mutate: ['src/**/*.{ts,tsx}', '!src/main.tsx', '!src/**/*.test.{ts,tsx}'],
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  thresholds: {
    high: 95,
    low: 90,
    break: 90,
  },
  // `incremental` is controlled per-invocation via the CLI flag
  // (`test:mutation` runs a full pass, `test:mutation:incremental` passes
  // `--incremental`) rather than forced on here, so the two npm scripts stay
  // meaningfully different.
  incrementalFile: '.stryker-tmp/incremental.json',
}
