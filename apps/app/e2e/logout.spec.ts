import { test, expect } from '@playwright/test'
import { componentAxeBuilder } from '../src/test-support/axe'
import { computeTotpCode } from './fixtures/totp'

// S18-02: entra pelo caminho do profissional (registo + TOTP em `/`), não magic-link -- evita
// WebAuthn/CDP. Prova o ponto único de purga (SessionProvider.purgarConta): sessionStorage vazio
// depois do logout. A KEK só vive na memória da página, então nada aqui recarrega.

test.describe.configure({ mode: 'serial' })
test.use({ locale: 'pt-BR' })

function uniqueProfessionalEmail(label: string): string {
  return `logout-e2e-${label}-${crypto.randomUUID()}@example.com`
}

test('a professional logs in, then logs out via the "Sair" button, and the session purges cleanly', async ({ page }) => {
  const email = uniqueProfessionalEmail('sair')
  const password = 'Senha-Segura!123'

  await page.goto('/')
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

  await expect(page.locator('#app-shell')).toBeVisible()
  await expect(page.getByTestId('conta-sessao')).toHaveText(email)

  expect((await componentAxeBuilder(page).analyze()).violations).toEqual([])

  await page.getByRole('button', { name: 'Sair' }).press('Enter')

  await expect(page.getByRole('button', { name: 'Sair' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Bem-vindo ao Limmiar' })).toBeVisible()
  await expect(page.locator('#app-shell')).toHaveCount(0)
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)

  expect((await componentAxeBuilder(page).analyze()).violations).toEqual([])
})
