import { expect, test } from '@playwright/experimental-ct-react'
import { CtI18nProvider } from '../../test-support/ct-i18n'
import { CtBibliotecaNotas } from '../../test-support/ct-biblioteca-notas'
import { componentAxeBuilder } from '../../test-support/axe'

// Ticket S08-02, fatia 4, critério de aceite 5 ("axe limpo"). Sem `toHaveScreenshot`: não
// pedido pelo ticket, e regressão visual é scope à parte (ver AuthScreen.spec.tsx).

test('biblioteca com grupos visíveis fica axe-clean', async ({ mount, page }) => {
  await mount(<CtI18nProvider><CtBibliotecaNotas /></CtI18nProvider>)
  await expect(page.getByRole('link', { name: 'Abrir nota 1', exact: true })).toBeVisible()

  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
