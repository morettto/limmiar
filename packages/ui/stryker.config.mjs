// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  // pnpm's non-flat node_modules means Stryker's automatic plugin resolution
  // (globbing "@stryker-mutator/*" in node_modules) can miss the runner;
  // list it explicitly so it's always found regardless of hoisting.
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: [
    'src/**/*.{ts,tsx}',
    '!src/index.ts',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/test-support/**',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  thresholds: {
    high: 95,
    low: 90,
    break: 90,
  },
  // `incremental` is set per invocation via the CLI flag (`test:mutation` runs
  // a full pass, `test:mutation:incremental` passes `--incremental`), so the
  // two npm scripts stay meaningfully different.
  incrementalFile: '.stryker-tmp/incremental.json',
}
