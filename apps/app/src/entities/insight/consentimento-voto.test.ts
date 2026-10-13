import { afterEach, describe, expect, it } from 'vitest'
import { CONSENTIMENTO_STORAGE_KEY_PREFIX, gravarConsentimento, lerConsentimento } from './consentimento-voto'

describe('consentimento de envio de votos', () => {
  afterEach(() => localStorage.clear())
  it('ausente ou inválido lê como null; sim e nao voltam por conta', () => {
    expect(lerConsentimento('a')).toBeNull()
    localStorage.setItem(`${CONSENTIMENTO_STORAGE_KEY_PREFIX}:a`, 'talvez')
    expect(lerConsentimento('a')).toBeNull()
    gravarConsentimento('a', 'sim')
    gravarConsentimento('b', 'nao')
    expect([lerConsentimento('a'), lerConsentimento('b')]).toEqual(['sim', 'nao'])
  })
})
