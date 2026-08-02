import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8787',
  },
  webServer: [
    {
      command: 'pnpm run build && pnpm exec wrangler dev --port 8787 --local-protocol http',
      url: 'http://127.0.0.1:8787',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node e2e/fixtures/serve-third-party.mjs',
      url: 'http://127.0.0.1:5333',
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
