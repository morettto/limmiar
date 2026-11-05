import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: 'clinical-vault.spec.ts', workers: 1,
  outputDir: '../../.local/vault-browser', timeout: 60000,
  use: { baseURL: 'http://localhost:5193', browserName: 'chromium', viewport: { width: 1280, height: 900 }, locale: 'pt-BR' },
  webServer: { command: 'pnpm exec vite --host localhost --port 5193 --strictPort', url: 'http://localhost:5193', reuseExistingServer: !process.env.CI },
})
