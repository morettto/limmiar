import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { SECURITY_HEADERS } from './security-headers.ts'

// https://vite.dev/config/
export default defineConfig({
  // @vitejs/plugin-react v6 dropped its Babel integration (Oxc JSX transform now), so
  // Lingui's macros run as their own @rolldown/plugin-babel pass instead of through
  // react()'s removed `babel` option.
  plugins: [react(), lingui(), babel({ presets: [linguiTransformerBabelPreset()] }), tailwindcss()],
  // Mirrors public/_headers (the real Cloudflare-served headers) so `vite
  // preview` — used by the DAST (ZAP) CI job — reflects actual production
  // header posture instead of scanning a preview server with none of it.
  preview: {
    headers: { ...SECURITY_HEADERS },
  },
  test: {
    environment: 'jsdom',
    // Playwright owns e2e/** and src/**/*.spec.tsx (CT), so Vitest stays on
    // *.test.{ts,tsx}; without the split it would try to run Playwright `test()` calls.
    // security-headers.test.ts sits at the app root, outside the src glob.
    include: ['src/**/*.test.{ts,tsx}', '*.test.{ts,tsx}'],
    // Pact consumer tests drive a real mock-server process through the whole client
    // pipeline: contract tests, not unit tests, run by test:pact instead. Spreading
    // configDefaults.exclude keeps Vitest's own default ignores.
    exclude: [...configDefaults.exclude, '**/*.pact.test.ts'],
    // jsdom's CSS deps ship ESM-only files loaded via require(); the local
    // Node (22.11) needs this flag explicitly (it's unflagged from 22.12+).
    execArgv: ['--experimental-require-module'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html'],
      // Discover every source file, not just imported ones, so a new file with no test
      // fails the gate instead of vanishing from the report. security-headers.ts is build
      // layer but real logic (CSP derivation), so it is listed explicitly.
      include: ['src/**/*.{ts,tsx}', 'security-headers.ts'],
      // main.tsx is the bootstrap entry point with no branching to assert on; *.spec.tsx
      // and test-support/** belong to the Playwright CT run ("test:visual"), not to this
      // Vitest+Istanbul one.
      exclude: ['src/main.tsx', 'src/**/*.spec.{ts,tsx}', 'src/test-support/**'],
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
