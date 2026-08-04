import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { pseudoLocalize } from './pseudo-locale'

describe('pseudoLocalize — teste de mesa (ADR-S00.5-06: extend 0.35, ⟦…⟧)', () => {
  // Valores exatos travam a receita da ADR contra pseudolocale@2.3.0 — se a
  // lib ou as opções mudarem, este teste pega a mudança de output antes de
  // qualquer *.spec.tsx de regressão visual.
  const cases: Array<[string, string, string]> = [
    ['string vazia — só os delimitadores', '', '⟦⟧'],
    ['só dígitos — sem letra pra acentuar, mas ainda delimitado', '24', '⟦24⟧'],
    ['rótulo curto real (AdaptiveNav "Mais")', 'Mais', '⟦Ḿàĩś⟧'],
    ['fixture real com pontuação e número (HeaderAction)', 'Iniciar: Amelia 15:30', '⟦   Ĩńĩćĩàŕ: Àḿēĺĩà 15:30   ⟧'],
  ]

  it.each(cases)('%s', (_description, input, expected) => {
    expect(pseudoLocalize(input)).toBe(expected)
  })
})

describe('pseudoLocalize — property-based (fast-check)', () => {
  it('never throws, for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => pseudoLocalize(input)).not.toThrow()
      }),
    )
  })

  it('always starts with ⟦ and ends with ⟧, for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = pseudoLocalize(input)
        expect(result.startsWith('⟦')).toBe(true)
        expect(result.endsWith('⟧')).toBe(true)
      }),
    )
  })

  it('is always strictly longer than the input, for any non-empty string input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (input) => {
        expect(pseudoLocalize(input).length).toBeGreaterThan(input.length)
      }),
    )
  })
})
