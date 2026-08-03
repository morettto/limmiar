import { describe, expect, it } from 'vitest'
import {
  getDateTimeFormat,
  getListFormat,
  getNumberFormat,
  getPluralRules,
  getRelativeTimeFormat,
} from './formatters'

describe('formatters — memoization', () => {
  it('returns the same Intl.NumberFormat instance for the same locale and no options', () => {
    expect(getNumberFormat('pt-BR')).toBe(getNumberFormat('pt-BR'))
  })

  it('returns a different instance for a different locale', () => {
    expect(getNumberFormat('pt-BR')).not.toBe(getNumberFormat('en-US'))
  })

  it('returns a different instance for different options', () => {
    const plain = getNumberFormat('pt-BR')
    const currency = getNumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    expect(plain).not.toBe(currency)
  })

  it('treats no options and explicit empty options as the same cache entry', () => {
    expect(getNumberFormat('pt-BR')).toBe(getNumberFormat('pt-BR', {}))
  })

  it('returns the same instance for the same locale+options across the other 4 formatter kinds', () => {
    expect(getDateTimeFormat('pt-BR')).toBe(getDateTimeFormat('pt-BR'))
    expect(getRelativeTimeFormat('pt-BR')).toBe(getRelativeTimeFormat('pt-BR'))
    expect(getListFormat('pt-BR')).toBe(getListFormat('pt-BR'))
    expect(getPluralRules('pt-BR')).toBe(getPluralRules('pt-BR'))
  })
})

describe('formatters — output threads the locale through (not just cached blindly)', () => {
  it('formats numbers per locale grouping/decimal convention', () => {
    expect(getNumberFormat('pt-BR').format(1234.5)).toBe('1.234,5')
    expect(getNumberFormat('en-US').format(1234.5)).toBe('1,234.5')
  })

  it('formats dates per locale field order', () => {
    const date = new Date(Date.UTC(2026, 0, 15))
    const options = { dateStyle: 'short', timeZone: 'UTC' } as const
    expect(getDateTimeFormat('pt-BR', options).format(date)).toBe('15/01/2026')
    expect(getDateTimeFormat('en-US', options).format(date)).toBe('1/15/26')
  })

  it('formats relative time per locale vocabulary', () => {
    const options = { numeric: 'auto' } as const
    expect(getRelativeTimeFormat('pt-BR', options).format(-1, 'day')).toBe('ontem')
    expect(getRelativeTimeFormat('en-US', options).format(-1, 'day')).toBe('yesterday')
  })

  it('formats lists per locale conjunction style', () => {
    const options = { type: 'conjunction' } as const
    expect(getListFormat('pt-BR', options).format(['a', 'b', 'c'])).toBe('a, b e c')
    expect(getListFormat('en-US', options).format(['a', 'b', 'c'])).toBe('a, b, and c')
  })

  it('selects the same CLDR plural category across all 4 supported locales (shared one/other partition)', () => {
    for (const locale of ['pt-BR', 'es-419', 'it-IT', 'en-US'] as const) {
      expect(getPluralRules(locale).select(1)).toBe('one')
      expect(getPluralRules(locale).select(2)).toBe('other')
    }
  })
})
