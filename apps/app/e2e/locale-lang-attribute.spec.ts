import { test, expect, type Page } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../src/shared/i18n/locale/local-storage-locale-store'

const seletor = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true })
const CATALOGO = /\/assets\/messages-[^/]+\.js$/

test.describe('boot: the browser language is ignored, the base locale is pt-BR', () => {
  test.use({ locale: 'en-US' })

  test('document.documentElement.lang is pt-BR even with an English browser', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await expect(seletor(page, 'Idioma')).toHaveValue('pt-BR')
  })
})

test.describe('boot: a persisted localStorage locale beats the base locale', () => {
  test.use({ locale: 'it-IT' })

  test('document.documentElement.lang resolves to the seeded localStorage locale', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [LOCALE_STORAGE_KEY, 'es-419'] as [string, string],
    )

    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'es-419')
    await expect(seletor(page, 'Idioma')).toHaveValue('es-419')
  })
})

test.describe('live switch: the language selector updates lang without a reload and persists it', () => {
  test('lang and label update immediately, localStorage keeps the choice across a reload', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

    await seletor(page, 'Idioma').selectOption('en-US')

    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
    await expect(seletor(page, 'Language')).toHaveValue('en-US')
    const persisted = await page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY)
    expect(persisted).toBe('en-US')

    await page.reload()

    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  })
})

test.describe('fallback: a catalog that fails to load leaves the active locale untouched', () => {
  test('lang and selector stay on pt-BR when the en-US catalog chunk is unreachable', async ({ page }) => {
    // Only the boot catalog gets through: the post-boot prefetch and the switch both hit an aborted chunk.
    let liberadas = 1
    await page.route(CATALOGO, (route) => (liberadas-- > 0 ? route.continue() : route.abort()))
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

    const failure = page.waitForEvent('console', (message) => message.text().includes('failed to load catalog'))
    await seletor(page, 'Idioma').selectOption('en-US')
    await failure

    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await expect(seletor(page, 'Idioma')).toHaveValue('pt-BR')
  })
})

test.describe('prefetch: every catalog is cached after boot, so the first switch needs no network', () => {
  test('lang flips to each language with every catalog request aborted', async ({ page }) => {
    const catalogos = new Set<string>()
    page.on('requestfinished', (request) => { if (CATALOGO.test(request.url())) catalogos.add(request.url()) })
    await page.goto('/')
    await expect.poll(() => catalogos.size).toBe(4)

    await page.route(CATALOGO, (route) => route.abort())
    for (const locale of ['en-US', 'es-419', 'it-IT']) {
      await page.locator('.language-switcher select').selectOption(locale)
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
    }
  })
})
