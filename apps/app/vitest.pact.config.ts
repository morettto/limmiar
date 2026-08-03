import { defineConfig } from 'vitest/config'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'

// A deliberately separate config from vite.config.ts's own `test` block:
// Pact consumer tests spin up a real mock-server process per interaction and
// exercise getHealthDb -> translateProblemCode against a live .po-derived
// catalog. That's a contract test, not a coverage-gated unit test, so it
// must never run under `test:unit`'s istanbul instrumentation (see the
// matching `exclude` in vite.config.ts) — this config is what `test:pact`
// points at instead. Needs the same lingui() + babel-macro pieces as the
// main config: dynamicActivate()'s `import(`./locales/${locale}/messages.po`)`
// and problem-messages.ts's `msg()` macro both need them to resolve.
export default defineConfig({
  plugins: [lingui(), babel({ presets: [linguiTransformerBabelPreset()] })],
  test: {
    environment: 'jsdom',
    include: ['src/api/client.pact.test.ts'],
    execArgv: ['--experimental-require-module'],
  },
})
