import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
