import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The spec provisions its professional against `pnpm dev`, whose staff key lives in .local/settings.json (tools/dev.mjs).
const settings = fileURLToPath(new URL('../../../.local/settings.json', import.meta.url))
if (!process.env.LIMMIAR_E2E_STAFF_API_KEY && existsSync(settings)) {
  process.env.LIMMIAR_E2E_STAFF_API_KEY = JSON.parse(readFileSync(settings, 'utf8').replace(/^﻿/, '')).StaffAccess.ApiKey
}

export default defineConfig({
  testDir: '.',
  testMatch: 'live-asr-latency.spec.ts',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.LIVE_ASR_BASE_URL ?? 'http://localhost:5173',
    storageState: process.env.LIVE_ASR_STORAGE_STATE,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    locale: 'pt-BR',
    permissions: ['microphone'],
    ...devices['Desktop Chrome'],
  },
})
