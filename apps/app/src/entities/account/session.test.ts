import { describe, expect, it } from 'vitest'
import { criarSessaoDeConta, type KeyValueStorage } from './session'

const ACCOUNT = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  role: 'Professional' as const,
  twoFactorRequirement: 'NotApplicable' as const,
  twoFactorTicket: 'a-real-2fa-ticket',
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

  it('ler() returns null when email is missing', () => {
    const storage = createFakeStorage()
    const { email: _email, ...semEmail } = ACCOUNT
    storage.setItem('limmiar:account', JSON.stringify(semEmail))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when role is not one of the known roles (a forged sessionStorage value)', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify({ ...ACCOUNT, role: 'Admin' }))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('ler() returns null when twoFactorRequirement is not one of the known values', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify({ ...ACCOUNT, twoFactorRequirement: 'Bypassed' }))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toBeNull()
  })

  it('registar() then ler() round-trips the account, minus twoFactorTicket', () => {
    const sessao = criarSessaoDeConta(createFakeStorage())

    sessao.registar(ACCOUNT)

    expect(sessao.ler()).toEqual({ ...ACCOUNT, twoFactorTicket: null })
  })

  it('registar() never writes twoFactorTicket to storage -- the raw JSON has no trace of it', () => {
    const storage = createFakeStorage()
    const sessao = criarSessaoDeConta(storage)

    sessao.registar(ACCOUNT)

    const raw = storage.getItem('limmiar:account')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).not.toHaveProperty('twoFactorTicket')
  })

  it('ler() returns twoFactorTicket: null even if a leftover ticket is still in storage (pre-fix session)', () => {
    const storage = createFakeStorage()
    storage.setItem('limmiar:account', JSON.stringify(ACCOUNT))
    const sessao = criarSessaoDeConta(storage)

    expect(sessao.ler()).toEqual({ ...ACCOUNT, twoFactorTicket: null })
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
