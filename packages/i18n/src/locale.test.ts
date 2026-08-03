import { describe, expect, it } from 'vitest'
import { BASE_LOCALE, LOCALES } from './locale'

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
