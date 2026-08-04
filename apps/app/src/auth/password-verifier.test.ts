import { describe, expect, it } from 'vitest'
import { deriveEmailPasswordVerifier, deriveEmailSalt } from './password-verifier'

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

  it('produces a different salt for a different e-mail', async () => {
    const [a, b] = await Promise.all([deriveEmailSalt('user@example.com'), deriveEmailSalt('other@example.com')])

    expect(a).not.toEqual(b)
  })
})
