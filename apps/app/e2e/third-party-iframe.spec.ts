import { test, expect } from '@playwright/test'

test('iframe de terceiro cooperante (CORP cross-origin + COEP) carrega sob COEP credentialless', async ({ page }) => {
  const thirdPartyResponse = page.waitForResponse('http://127.0.0.1:5333/')

  await page.goto('/coep-iframe-check.html')

  const response = await thirdPartyResponse
  expect(response.status()).toBe(200)

  const frame = page.frameLocator('#third-party')
  await expect(frame.locator('p')).toHaveText(/terceiro/)
})
