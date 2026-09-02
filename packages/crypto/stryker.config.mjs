// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  // pnpm's non-flat node_modules: PluginLoader's import(bareName) resolves from
  // @stryker-mutator/core's own location in the store, which has no path to
  // vitest-runner, so only a relative file path makes the plugin load.
  plugins: ['./node_modules/@stryker-mutator/vitest-runner/dist/src/index.js'],
  // benchmark.ts is a manual calibration tool (see vite.config.ts), not
  // gated logic — excluded from mutation the same way it's excluded from
  // coverage.
  mutate: ['src/**/*.ts', '!src/index.ts', '!src/**/*.test.ts', '!src/benchmark.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['html', 'clear-text', 'progress'],
  // S01-01 (ASVS L3): this ticket's own acceptance criteria demand 100%
  // mutation score for the KDF wrapper — stricter than i18n/ui's 90.
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  // `incremental` is set per invocation via the CLI flag (`test:mutation` runs
  // a full pass, `test:mutation:incremental` passes `--incremental`), so the
  // two npm scripts stay meaningfully different.
  incrementalFile: '.stryker-tmp/incremental.json',
}
