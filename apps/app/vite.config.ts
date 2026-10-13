import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadEnv, type Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { SECURITY_HEADERS, securityHeaders, withHostedOrigins } from './security-headers.ts'

// The dev server injects inline scripts and styles (React refresh, HMR) that the CSP forbids.
const { 'Content-Security-Policy': _csp, ...DEV_HEADERS } = SECURITY_HEADERS

// Production-mode env: .env files plus any VITE_ variable of the shell (CI). The dev server needs none of it.
const env = loadEnv('production', process.cwd(), 'VITE_')

// Writes the build's API/copilot origins into the CSP of the _headers copied from public/.
function hostedOrigins(): Plugin {
  let headersPath = ''
  return {
    name: 'hosted-origins',
    apply: 'build',
    configResolved: (config) => { headersPath = join(resolve(config.root, config.build.outDir), '_headers') },
    closeBundle: async () => { await writeFile(headersPath, withHostedOrigins(await readFile(headersPath, 'utf8'), env)) },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // @vitejs/plugin-react v6 dropped its Babel integration (Oxc JSX transform now), so
  // Lingui's macros run as their own @rolldown/plugin-babel pass instead of through
  // react()'s removed `babel` option.
  plugins: [react(), lingui(), babel({ presets: [linguiTransformerBabelPreset()] }), tailwindcss(), hostedOrigins()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/coverage/**', '**/dist-e2e/**', '**/playwright/.cache/**'] },
    headers: DEV_HEADERS,
    proxy: {
        '^/auth/(register|login|google|refresh|logout|recover|magic-link/(verify|webauthn))': 'http://127.0.0.1:5259',
        '/accounts': 'http://127.0.0.1:5259',
        '/devices/pairing-sessions': 'http://127.0.0.1:5259',
        '/online-sessions': { target: 'http://127.0.0.1:5259', ws: true },
      '/health': 'http://127.0.0.1:5259',
      '/copiloto': { target: 'http://127.0.0.1:8000', rewrite: (path) => path.replace(/^\/copiloto/, '') },
      // Gateway de fala (apps/gateway-fala), que fala com o container nemotron-speech-1 (tools/nemotron): WebSocket em tempo real.
      '/speech': { target: 'http://127.0.0.1:8090', ws: true, rewrite: (path) => path.replace(/^\/speech/, '') },
    },
  },
  // Mirrors public/_headers (the real Cloudflare-served headers) so `vite
  // preview` — used by the DAST (ZAP) CI job — reflects actual production
  // header posture instead of scanning a preview server with none of it.
  preview: {
    headers: securityHeaders(env),
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
