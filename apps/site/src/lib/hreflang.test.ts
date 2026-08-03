import { describe, expect, it } from 'vitest'
import { LOCALES, BASE_LOCALE, type Locale } from '@limmiar/i18n'
import { buildHreflangAlternates } from './hreflang'

describe('buildHreflangAlternates', () => {
  const urlForLocale = (locale: Locale): string => `https://limmiar.example/${locale.toLowerCase()}/`

  it('returns one entry per configured locale plus a final x-default entry', () => {
    const result = buildHreflangAlternates(urlForLocale)

    expect(result).toHaveLength(LOCALES.length + 1)
  })

  it('returns entries in LOCALES order, each with matching hreflang and href', () => {
    const result = buildHreflangAlternates(urlForLocale)

    LOCALES.forEach((locale, index) => {
      expect(result[index]).toEqual({ hreflang: locale, href: urlForLocale(locale) })
    })
  })

  it('appends a final x-default entry pointing at the base locale URL', () => {
    const result = buildHreflangAlternates(urlForLocale)

    expect(result.at(-1)).toEqual({ hreflang: 'x-default', href: urlForLocale(BASE_LOCALE) })
  })

  it('calls urlForLocale exactly once per locale plus once for x-default', () => {
    const calls: Locale[] = []
    const spy = (locale: Locale): string => {
      calls.push(locale)
      return urlForLocale(locale)
    }

    buildHreflangAlternates(spy)

    expect(calls).toEqual([...LOCALES, BASE_LOCALE])
  })
})
