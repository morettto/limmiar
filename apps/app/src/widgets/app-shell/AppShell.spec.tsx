import { expect, test } from '@playwright/experimental-ct-react'
import { CtI18nProvider } from '../../test-support/ct-i18n'
import { CtAppShell } from '../../test-support/ct-app-shell'
import { componentAxeBuilder } from '../../test-support/axe'

// Menu só existe abaixo de 1024 px (o CSS esconde o botão acima): onde ele aparece, abre-se primeiro.
async function abrirTudo(page: import('@playwright/test').Page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Conta', exact: true }).click()
}

test('barra fechada marca o destino atual e fica axe-clean', async ({ mount, page }) => {
  await mount(<CtI18nProvider><CtAppShell caminho="/acervo" /></CtI18nProvider>)
  await expect(page.locator('a[aria-current="page"]')).toHaveText('Acervo pessoal')
  await expect(page).toHaveScreenshot('app-shell-fechada.png')
  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('menu e conta abertos mostram todos os destinos e ficam axe-clean', async ({ mount, page }) => {
  await mount(<CtI18nProvider><CtAppShell caminho="/pacientes" /></CtI18nProvider>)
  await abrirTudo(page)
  await expect(page.getByRole('link', { name: 'Trilha de auditoria', exact: true })).toBeVisible()
  await expect(page.locator('a[aria-current="page"]')).toHaveText('Pacientes')
  await expect(page).toHaveScreenshot('app-shell-aberta.png')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})

test('Enter abre a conta e Esc a fecha, devolvendo o foco ao botão', async ({ mount, page }) => {
  await mount(<CtI18nProvider><CtAppShell caminho="/" /></CtI18nProvider>)
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  const conta = page.getByRole('button', { name: 'Conta', exact: true })
  await conta.focus()
  await page.keyboard.press('Enter')
  await expect(conta).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Votos do copiloto de IA', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(conta).toHaveAttribute('aria-expanded', 'false')
  await expect(conta).toBeFocused()
})

test('navegação bloqueada desabilita os destinos, explica por quê e fica axe-clean', async ({ mount, page }) => {
  await mount(<CtI18nProvider><CtAppShell caminho="/acervo" bloqueada /></CtI18nProvider>)
  await expect(page.getByRole('status')).toBeVisible()
  await expect(page).toHaveScreenshot('app-shell-bloqueada.png')
  const results = await componentAxeBuilder(page).analyze()
  expect(results.violations).toEqual([])
})
