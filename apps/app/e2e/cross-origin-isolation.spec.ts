import { test, expect } from '@playwright/test'

test('app fica cross-origin isolated (COOP same-origin + COEP credentialless)', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin')
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('credentialless')

  const isolated = await page.evaluate(() => window.crossOriginIsolated)
  expect(isolated).toBe(true)
})
