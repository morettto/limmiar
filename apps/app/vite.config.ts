import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // @vitejs/plugin-react v6 dropped its own Babel integration (Oxc-based
  // JSX transform now) — Lingui's macros (t/<Trans>) still need a Babel
  // pass, so it runs as its own plugin via @rolldown/plugin-babel rather
  // than through react()'s (now-removed) `babel` option.
  plugins: [react(), lingui(), babel({ presets: [linguiTransformerBabelPreset()] }), tailwindcss()],
  // Mirrors public/_headers (the real Cloudflare-served headers) so `vite
  // preview` — used by the DAST (ZAP) CI job — reflects actual production
  // header posture instead of scanning a preview server with none of it.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'X-Content-Type-Options': 'nosniff',
    },
  },
  test: {
    environment: 'jsdom',
    // Playwright owns e2e/**; keep Vitest scoped to unit specs under src/.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Pact consumer tests spin up a real mock-server process and hit a live
    // .po-derived catalog through the whole client -> translateProblemCode
    // pipeline — they're contract tests, not unit tests, and must stay out
    // of this coverage-gated run (a separate "test:pact" script + CI job
    // runs them via vitest.pact.config.ts instead). Spreading
    // configDefaults.exclude keeps Vitest's own default ignores (node_modules,
    // dist, etc.) intact instead of replacing them.
    exclude: [...configDefaults.exclude, '**/*.pact.test.ts'],
    // jsdom's CSS deps ship ESM-only files loaded via require(); the local
    // Node (22.11) needs this flag explicitly (it's unflagged from 22.12+).
    execArgv: ['--experimental-require-module'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      // Discover every source file (not just ones a test happens to import),
      // so a new file added without a test fails the gate instead of being
      // silently absent from the report.
      include: ['src/**/*.{ts,tsx}'],
      // main.tsx is the app's bootstrap/entry point (createRoot + render);
      // it has no branching logic of its own to assert on, so it's excluded
      // by the conventional "don't test the entry point" rule, not to dodge
      // the 100% bar.
      exclude: ['src/main.tsx'],
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
