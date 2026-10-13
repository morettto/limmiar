import { describe, expect, it, vi } from 'vitest'
import { deriveKey } from '@limmiar/crypto'
import { deriveEmailPasswordVerifier, deriveEmailSalt } from './password-verifier'

vi.mock('@limmiar/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@limmiar/crypto')>()
  return { ...actual, deriveKey: vi.fn(actual.deriveKey) }
})

describe('deriveEmailPasswordVerifier', () => {
  it('returns a 32-byte verifier (ADR-S02-02 / AccountService.PasswordVerifierLength)', async () => {
    const salt = new Uint8Array(16).fill(0x02)

    const result = await deriveEmailPasswordVerifier('correct horse battery staple', salt)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).toHaveLength(32)
  })

  it('is deterministic: same password + same salt yields the same verifier', async () => {
    const salt = new Uint8Array(16).fill(0x07)

    const [a, b] = await Promise.all([
      deriveEmailPasswordVerifier('correct horse battery staple', salt),
      deriveEmailPasswordVerifier('correct horse battery staple', salt),
    ])

    expect(a).toEqual(b)
  })

  it('produces a different verifier for a different password under the same salt', async () => {
    const salt = new Uint8Array(16).fill(0x07)

    const [a, b] = await Promise.all([
      deriveEmailPasswordVerifier('correct horse battery staple', salt),
      deriveEmailPasswordVerifier('an entirely different password', salt),
    ])

    expect(a).not.toEqual(b)
  })
})

describe('deriveEmailPasswordVerifier: bytes da senha', () => {
  it('zera os bytes da senha depois de derivar, também quando a derivação falha', async () => {
    await deriveEmailPasswordVerifier('correct horse battery staple', new Uint8Array(16).fill(0x02))
    const usados = vi.mocked(deriveKey).mock.lastCall![0]
    expect(usados).toHaveLength('correct horse battery staple'.length)
    expect(usados.every((byte) => byte === 0)).toBe(true)

    vi.mocked(deriveKey).mockRejectedValueOnce(new Error('argon2'))
    await expect(deriveEmailPasswordVerifier('outra senha', new Uint8Array(16))).rejects.toThrow('argon2')
    expect(vi.mocked(deriveKey).mock.lastCall![0].every((byte) => byte === 0)).toBe(true)
  })
})

describe('deriveEmailSalt', () => {
  it('is deterministic for the exact same e-mail string', async () => {
    const [a, b] = await Promise.all([deriveEmailSalt('user@example.com'), deriveEmailSalt('user@example.com')])

    expect(a).toEqual(b)
  })

  it('normalizes case and surrounding whitespace the same way AccountService.NormalizeEmail does', async () => {
    const [a, b] = await Promise.all([
      deriveEmailSalt('  User@Example.com '),
      deriveEmailSalt('user@example.com'),
    ])

    expect(a).toEqual(b)
  })

  it('é o SHA-256 do e-mail normalizado em minúsculas', async () => {
    const esperado = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('user@example.com')))

    expect(await deriveEmailSalt(' USER@Example.COM	')).toEqual(esperado)
  })

  it('produces a different salt for a different e-mail', async () => {
    const [a, b] = await Promise.all([deriveEmailSalt('user@example.com'), deriveEmailSalt('other@example.com')])

    expect(a).not.toEqual(b)
  })
})
