import { expect, test } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../src/shared/i18n/locale/local-storage-locale-store'
import { axeBuilder } from '../src/test-support/axe'

const locales = ['pt-BR', 'en-US', 'es-419', 'it-IT'] as const
const screens = [
  { name: 'entrada', path: '/' },
  { name: 'recuperacao', path: '/recover' },
  { name: 'biblioteca-preparando', path: '/biblioteca' },
  { name: 'paciente-bloqueado', path: '/hoje' },
  { name: 'magic-link-invalido', path: '/auth/magic-link?token=editorial-invalid-test-token' },
]

for (const locale of locales) {
  test.describe(locale, () => {
    for (const screen of screens) {
      test(`${screen.name}: layout e acessibilidade`, async ({ page }) => {
        await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [LOCALE_STORAGE_KEY, locale] as [string, string])
        await page.goto(screen.path)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.getByRole('main')).toHaveCount(1)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
        const result = await axeBuilder(page).analyze()
        expect(result.violations).toEqual([])
        await page.screenshot({ path: test.info().outputPath(`${screen.name}.png`), fullPage: true })
      })
    }
  })
}
