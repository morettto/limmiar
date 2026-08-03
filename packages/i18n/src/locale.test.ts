import { describe, expect, it } from 'vitest'
import { BASE_LOCALE, isLocale, LOCALES } from './locale'

describe('locale', () => {
  it('lists the 4 supported locales, base first', () => {
    expect(LOCALES).toEqual(['pt-BR', 'es-419', 'it-IT', 'en-US'])
  })

  it('sets pt-BR as the base locale', () => {
    expect(BASE_LOCALE).toBe('pt-BR')
  })

  it('includes the base locale among the supported locales', () => {
    expect(LOCALES).toContain(BASE_LOCALE)
  })
})

describe('isLocale', () => {
  it.each(LOCALES)('accepts %s as a valid supported locale', (locale) => {
    expect(isLocale(locale)).toBe(true)
  })

  it('rejects an unsupported locale-shaped string', () => {
    expect(isLocale('fr-FR')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isLocale('')).toBe(false)
  })

  it('rejects non-string values (null, undefined, number, object)', () => {
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(42)).toBe(false)
    expect(isLocale({})).toBe(false)
  })
})
