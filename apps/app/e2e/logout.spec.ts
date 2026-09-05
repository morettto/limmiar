import { test, expect } from '@playwright/test'
import { API_BASE_URL } from '../playwright.config'
import { componentAxeBuilder } from '../src/test-support/axe'
import { computeTotpCode } from './fixtures/totp'

// S18-02: entra pelo caminho do profissional (registo + TOTP via /auth/screen), não magic-link --
// evita WebAuthn/CDP (ver magic-link-login.spec.ts para essa outra rota). Prova o ponto único de
// purga (SessionProvider.purgarConta) num browser real: sessionStorage vazio depois do logout.

test.describe.configure({ mode: 'serial' })
test.use({ locale: 'pt-BR' })

function uniqueProfessionalEmail(label: string): string {
  return `logout-e2e-${label}-${crypto.randomUUID()}@example.com`
}

test('a professional logs in, then logs out via the "Sair" button, and the session purges cleanly', async ({ page }) => {
  const email = uniqueProfessionalEmail('sair')
  const password = 'Senha-Segura!123'

  await page.goto(`/auth/screen?${new URLSearchParams({ baseUrl: API_BASE_URL, role: 'Professional' }).toString()}`)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  // Fresh Professional accounts always start twoFactorRequirement: SetupRequired (ADR-S02-03),
  // so TotpSetup mounts automatically and the secret arrives once its `begin` call resolves.
  const secretInput = page.getByLabel('Código secreto')
  await expect(secretInput).not.toHaveValue('')
  const secret = await secretInput.inputValue()

  await page.getByLabel('Código de 6 dígitos do aplicativo autenticador').fill(computeTotpCode(secret, Math.floor(Date.now() / 1000)))
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await page.getByRole('button', { name: 'Guardei meus códigos' }).click()

  await page.goto('/')
  await expect(page.locator('#app-shell')).toBeVisible()
  await expect(page.getByTestId('conta-sessao')).toHaveText(email)

  expect((await componentAxeBuilder(page).analyze()).violations).toEqual([])

  await page.getByRole('button', { name: 'Sair' }).press('Enter')

  await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0)
  await expect(page.locator('#app-shell')).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)

  expect((await componentAxeBuilder(page).analyze()).violations).toEqual([])
})
