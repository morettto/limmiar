import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4321',
  },
  webServer: {
    // Static output, no adapter needed — build then serve the static dist/
    // via Astro's own preview server (mirrors apps/app's build-then-serve
    // pattern, using Astro's commands instead of wrangler).
    command: 'pnpm run build && pnpm exec astro preview --host 127.0.0.1 --port 4321',
    // Health-check a real page, not the bare origin: with
    // routing.prefixDefaultLocale true and no redirectToDefaultLocale, "/"
    // 404s by design (every locale lives under its own prefix), which would
    // make Playwright wait out the full timeout for a 2xx that never comes.
    url: 'http://127.0.0.1:4321/pt-br/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
