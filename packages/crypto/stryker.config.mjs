// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  // pnpm's non-flat node_modules means Stryker's automatic plugin resolution
  // (globbing "@stryker-mutator/*" in node_modules) can miss the runner;
  // list it explicitly so it's always found regardless of hoisting.
  // A bare package specifier isn't enough on its own, though: PluginLoader's
  // `import(moduleName)` is resolved relative to @stryker-mutator/core's own
  // location deep in the pnpm store, and core has no dependency on
  // vitest-runner (they're peers, both declared only in this package's
  // package.json) — so Node's bare-specifier lookup walking up from core
  // never finds it, and the plugin silently fails to load ("Cannot find
  // TestRunner plugin \"vitest\""). Using a relative file path instead makes
  // PluginLoader take its `path.resolve(pluginExpression)` branch, which
  // resolves against `process.cwd()` (this package's root) rather than
  // core's install location, and points straight at the real entry file.
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
  // `incremental` is controlled per-invocation via the CLI flag
  // (`test:mutation` runs a full pass, `test:mutation:incremental` passes
  // `--incremental`) rather than forced on here, so the two npm scripts stay
  // meaningfully different.
  incrementalFile: '.stryker-tmp/incremental.json',
}
