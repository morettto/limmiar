import { test, expect } from '@playwright/test'

// S10-02 fatia 6 -- critério de aceite 3 num Chromium REAL: o browser é lançado com microfone
// falso e permissão já concedida, logo daria a stream se a pedíssemos. O que se prova é que o
// nosso código, com consentimento revogado, nunca chega a pedir.

// Rota '/e2e/microfone' (andaime atrás de VITE_ENABLE_E2E_TEST_ROUTES); o ida-e-volta ao
// servidor já é provado pelas fatias 3 e 4.

// `launchOptions` só é aceite no topo do ficheiro, por isso test.use fica fora do describe.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream'],
  },
})

test.describe('consentimento de gravação x microfone (S10-02)', () => {
  test('com consentimento revogado, o botão de gravar não abre o microfone', async ({ page }) => {
    await page.goto('/e2e/microfone?consentimento=revogado')

    await page.getByRole('button', { name: 'Gravar' }).click()

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveText('consentimento-ausente')
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})
