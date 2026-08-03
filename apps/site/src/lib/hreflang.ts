import { LOCALES, BASE_LOCALE, type Locale } from '@limmiar/i18n'

export interface HreflangAlternate {
  hreflang: Locale | 'x-default'
  href: string
}

/**
 * Builds the list of <link rel="alternate" hreflang="..."> entries for a
 * page: one per configured locale, plus a trailing x-default entry pointing
 * at the base locale (the SEO-recommended fallback for user agents/locales
 * that don't match any of the explicit alternates).
 *
 * Deliberately does not import `astro:i18n` — that virtual module only
 * resolves inside Astro's own build context. Keeping this file free of it is
 * what makes it a plain, testable pure function under Vitest with no Astro
 * test harness required.
 */
export function buildHreflangAlternates(urlForLocale: (locale: Locale) => string): HreflangAlternate[] {
  return [
    ...LOCALES.map((locale) => ({ hreflang: locale, href: urlForLocale(locale) })),
    { hreflang: 'x-default' as const, href: urlForLocale(BASE_LOCALE) },
  ]
}
