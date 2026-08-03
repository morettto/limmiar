import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LOCALES, BASE_LOCALE, type Locale } from './locale'
import { negotiateLocale } from './negotiate'

describe('negotiateLocale — teste de mesa (RFC 4647 lookup)', () => {
  const cases: Array<[string, string | readonly string[] | null | undefined, Locale]> = [
    ['exact match, single preference', 'it-IT', 'it-IT'],
    ['exact match, case-insensitive', 'EN-us', 'en-US'],
    ['q-weighted: higher q wins even listed second', 'en-US;q=0.5, es-419;q=0.9', 'es-419'],
    ['equal q: first listed wins (stable order)', 'it-IT, en-US', 'it-IT'],
    [
      'first preference unavailable, second matches',
      'fr-FR, pt-BR',
      'pt-BR',
    ],
    [
      'region-only truncation does not upgrade a bare primary tag',
      'pt',
      BASE_LOCALE,
    ],
    [
      'unrelated region does not fall back to an available region for the same language',
      'es-MX',
      BASE_LOCALE,
    ],
    ['wildcard alone resolves to base', '*', BASE_LOCALE],
    ['unknown locale list resolves to base', 'de-DE, ja-JP', BASE_LOCALE],
    ['navigator.languages-shaped array, first match wins', ['fr-FR', 'es-419', 'pt-BR'], 'es-419'],
    ['empty string resolves to base', '', BASE_LOCALE],
    ['null resolves to base', null, BASE_LOCALE],
    ['undefined resolves to base', undefined, BASE_LOCALE],
    ['empty array resolves to base', [], BASE_LOCALE],
    [
      'q=0 means explicitly not acceptable, excluded entirely (not just deprioritized)',
      'es-419;q=0',
      BASE_LOCALE,
    ],
    [
      'q param is trimmed after a semicolon+space, not just a bare semicolon',
      'en-US; q=0.1, pt-BR;q=0.5',
      'pt-BR',
    ],
    [
      'a non-q parameter must never be misread as the q parameter',
      'pt-BR, en-US;xx9.9',
      BASE_LOCALE,
    ],
    [
      'extra subtag truncates down to an available match instead of giving up on the first miss',
      'es-419-someVariant',
      'es-419',
    ],
  ]

  it.each(cases)('%s', (_description, preferences, expected) => {
    expect(negotiateLocale(preferences)).toBe(expected)
  })
})

describe('negotiateLocale — property-based (fast-check)', () => {
  it('never throws and always resolves to one of the 4 supported locales, for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = negotiateLocale(input)
        expect(LOCALES).toContain(result)
      }),
    )
  })

  it('never throws and always resolves to one of the 4 supported locales, for any array-of-strings input', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (input) => {
        const result = negotiateLocale(input)
        expect(LOCALES).toContain(result)
      }),
    )
  })

  it('never throws for a raw Accept-Language-shaped garbage string (weights, semicolons, unicode)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.string(), fc.option(fc.string(), { nil: undefined })).map(
            ([tag, q]) => (q === undefined ? tag : `${tag};q=${q}`),
          ),
        ),
        (parts) => {
          const header = parts.join(',')
          const result = negotiateLocale(header)
          expect(LOCALES).toContain(result)
        },
      ),
    )
  })
})
