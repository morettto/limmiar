import { expect, test } from '@playwright/test'
import { LOCALES, BASE_LOCALE } from '@limmiar/i18n'

const pathFor = (locale: string): string => `/${locale.toLowerCase()}/`

for (const locale of LOCALES) {
  test.describe(`locale route: ${locale}`, () => {
    test(`responds 200 and sets <html lang="${locale}">`, async ({ page }) => {
      const response = await page.goto(pathFor(locale))

      expect(response?.status()).toBe(200)
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
    })

    test('emits a canonical link matching the page\'s own absolute URL', async ({ page, baseURL }) => {
      await page.goto(pathFor(locale))

      const canonicalHref = await page.locator('link[rel="canonical"]').evaluate((el) => (el as HTMLLinkElement).href)

      expect(canonicalHref).toBe(new URL(pathFor(locale), baseURL).toString())
    })

    test('emits an hreflang alternate for every configured locale plus x-default', async ({ page, baseURL }) => {
      await page.goto(pathFor(locale))

      for (const altLocale of LOCALES) {
        const href = await page
          .locator(`link[rel="alternate"][hreflang="${altLocale}"]`)
          .evaluate((el) => (el as HTMLLinkElement).href)

        expect(href).toBe(new URL(pathFor(altLocale), baseURL).toString())
      }

      const xDefaultHref = await page
        .locator('link[rel="alternate"][hreflang="x-default"]')
        .evaluate((el) => (el as HTMLLinkElement).href)

      expect(xDefaultHref).toBe(new URL(pathFor(BASE_LOCALE), baseURL).toString())
    })
  })
}

test('ships zero <script type="module"> tags on a placeholder page (no i18n runtime/JS framework, per ADR-S00.5-02)', async ({
  page,
}) => {
  await page.goto(pathFor(BASE_LOCALE))

  await expect(page.locator('script[type="module"]')).toHaveCount(0)
})
