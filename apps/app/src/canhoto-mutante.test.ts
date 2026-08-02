// DEFEITO PROPOSITAL (PR canhoto, ticket S00-02) — teste fraco de propósito:
// cobre a linha (gate de cobertura passa) mas não afirma o valor exato
// (gate de mutação reprova, mutante de string literal sobrevive).
import { describe, expect, it } from 'vitest'
import { greetingLabel } from './canhoto-mutante'

describe('greetingLabel (canhoto)', () => {
  it('returns a string', () => {
    expect(typeof greetingLabel()).toBe('string')
  })
})
