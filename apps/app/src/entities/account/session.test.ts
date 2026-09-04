import { describe, expect, it } from 'vitest'
import { criarSessaoDeConta, type KeyValueStorage } from './session'

const ACCOUNT = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  role: 'Professional' as const,
  twoFactorRequirement: 'NotApplicable' as const,
  twoFactorTicket: null,
}

function createFakeStorage(): KeyValueStorage {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

describe('criarSessaoDeConta', () => {
  it('ler() returns null when nothing was ever recorded', () => {
    const sessao = criarSessaoDeConta(createFakeStorage())

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when the stored value is not valid JSON', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', 'not-json{')
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when the parsed value is not a non-null object (array included)', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify(['not', 'an', 'object']))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when the parsed value is a primitive, not an object', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify('just a string'))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when the stored value parses to JSON null', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify(null))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when the parsed value has no string id', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify({ email: 'user@example.com' }))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when id is an empty string', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify({ ...ACCOUNT, id: '' }))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('registar() then ler() round-trips the account', () => {
    const sessao = criarSessaoDeConta(createFakeStorage())

    sessao.registar(ACCOUNT)

    expect(sessao.ler()).toEqual(ACCOUNT)
  })

  it('terminar() then ler() returns null', () => {
    const sessao = criarSessaoDeConta(createFakeStorage())
    sessao.registar(ACCOUNT)

    sessao.terminar()

    expect(sessao.ler()).toBeNull()
  })

  it('terminar() is idempotent -- calling it twice does not throw', () => {
    const sessao = criarSessaoDeConta(createFakeStorage())
    sessao.registar(ACCOUNT)
    sessao.terminar()

    expect(() => sessao.terminar()).not.toThrow()
    expect(sessao.ler()).toBeNull()
  })
})
