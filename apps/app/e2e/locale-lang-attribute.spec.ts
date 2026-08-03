import { test, expect } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../src/locale/local-storage-locale-store'

declare global {
  interface Window {
    limmiarI18n?: {
      setLocale: (locale: string) => Promise<void>
      dynamicActivate: (locale: string) => Promise<void>
    }
  }
}

test.describe('boot: no persisted locale, browser locale is supported', () => {
  test.use({ locale: 'it-IT' })

  test('document.documentElement.lang matches the browser locale', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'it-IT')
  })
})

test.describe('boot: a persisted localStorage locale beats the browser locale (ADR-S00.5-05 order)', () => {
  test.use({ locale: 'it-IT' })

  test('document.documentElement.lang resolves to the seeded localStorage locale, not the browser one', async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [LOCALE_STORAGE_KEY, 'es-419'] as [string, string],
    )

    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'es-419')
  })
})

test.describe('boot: an unsupported browser locale falls back to the base locale', () => {
  test.use({ locale: 'de-DE' })

  test('document.documentElement.lang falls back to pt-BR', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  })
})

test.describe('live switch: window.limmiarI18n.setLocale updates lang without a reload and persists it', () => {
  test.use({ locale: 'it-IT' })

  test('lang updates immediately and localStorage reflects the new locale', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'it-IT')

    await page.evaluate(() => window.limmiarI18n?.setLocale('en-US'))

    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')

    const persisted = await page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY)
    expect(persisted).toBe('en-US')
  })
})

test.describe('fallback: window.limmiarI18n.dynamicActivate for a locale with no compiled catalog', () => {
  test.use({ locale: 'it-IT' })

  test('document.documentElement.lang is left unchanged', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'it-IT')

    // No catalog exists for this made-up locale, so the dynamic import
    // genuinely rejects inside the app (module/chunk not found) — the same
    // real-rejection technique used by the unit tests, exercised here
    // against the actually-running app instead of an imported function.
    await page.evaluate(() => window.limmiarI18n?.dynamicActivate('xx-XX'))

    await expect(page.locator('html')).toHaveAttribute('lang', 'it-IT')
  })
})
