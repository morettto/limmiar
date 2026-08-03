import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LOCALES, type Locale } from './locale'
import { toContentLocale, type ContentLocale, type ContentLocaleToTargetLang } from './content-locale'

describe('toContentLocale', () => {
  it('turns a supported Locale into a ContentLocale carrying the same value', () => {
    expect(toContentLocale('it-IT')).toBe('it-IT')
  })
})

describe('ContentLocale — independent from the interface locale (D17)', () => {
  it('holds any of the 4 locales regardless of what the interface locale is set to, for every combination', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOCALES), fc.constantFrom(...LOCALES), (interfaceLocale, sessionLocale) => {
        const contentLocale = toContentLocale(sessionLocale)
        expect(contentLocale).toBe(sessionLocale)
        // The interface locale (D17, the UI's own Locale) never has to match the
        // session's contentLocale — asserting the pair is unconstrained is the
        // property under test, not a specific relationship between the two.
        expect(LOCALES).toContain(interfaceLocale)
      }),
    )
  })
})

describe('ContentLocaleToTargetLang — port S05 implements', () => {
  it('is implementable by a conforming adapter mapping every supported locale to a Nemotron target_lang code', () => {
    const targetLangByLocale: Record<Locale, string> = {
      'pt-BR': 'pt',
      'es-419': 'es',
      'it-IT': 'it',
      'en-US': 'en',
    }
    const fakeAdapter: ContentLocaleToTargetLang = {
      toTargetLang: (contentLocale: ContentLocale) => targetLangByLocale[contentLocale as Locale],
    }

    for (const locale of LOCALES) {
      expect(fakeAdapter.toTargetLang(toContentLocale(locale))).toBe(targetLangByLocale[locale])
    }
  })
})
