import { test, expect } from '@playwright/test'

// S07-04: proves the real navigation entry point into CopilotKeySetup -- the index route's
// link -- and that "Pular" is reachable even with today's always-locked keychain (no
// KeychainProvider mounted yet, see router.tsx's own doc comment on CopilotSettingsRouteComponent).
// Own file, not a `describe` added to copilot-byok.spec.ts: that spec depends on real internet
// access to three third-party APIs and can be red for reasons unrelated to this ticket.

test.describe('CopilotKeySetup reachable from the index route (S07-04)', () => {
  test.use({ locale: 'pt-BR' })

  test('navigating to /settings/copilot and back via "Pular" writes nothing to localStorage', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Configurar copiloto de IA' }).click()

    await expect(page).toHaveURL(/\/settings\/copilot$/)
    await expect(page.getByRole('status')).toBeVisible()

    await page.getByRole('button', { name: 'Pular' }).click()

    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Configurar copiloto de IA' })).toBeVisible()

    const localStorageLength = await page.evaluate(() => window.localStorage.length)
    expect(localStorageLength).toBe(0)
  })
})
