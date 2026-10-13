import { describe, expect, it, vi } from 'vitest'
import { deriveKey } from '@limmiar/crypto'
import { deriveRecoveryVerifier } from './recovery-verifier'

vi.mock('@limmiar/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@limmiar/crypto')>()
  return { ...actual, deriveKey: vi.fn(actual.deriveKey) }
})

describe('deriveRecoveryVerifier', () => {
  it('returns a 32-byte verifier (AccountService.RecoveryVerifierLength)', async () => {
    const salt = new Uint8Array(16).fill(0x02)

    const result = await deriveRecoveryVerifier(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      salt,
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).toHaveLength(32)
  })

  it('is deterministic: same mnemonic + same salt yields the same verifier', async () => {
    const salt = new Uint8Array(16).fill(0x07)
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    const [a, b] = await Promise.all([deriveRecoveryVerifier(mnemonic, salt), deriveRecoveryVerifier(mnemonic, salt)])

    expect(a).toEqual(b)
  })

  it('produces a different verifier for a different mnemonic under the same salt', async () => {
    const salt = new Uint8Array(16).fill(0x07)

    const [a, b] = await Promise.all([
      deriveRecoveryVerifier(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        salt,
      ),
      deriveRecoveryVerifier(
        'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always',
        salt,
      ),
    ])

    expect(a).not.toEqual(b)
  })

  it('produces a different verifier for the same mnemonic under a different salt', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    const [a, b] = await Promise.all([
      deriveRecoveryVerifier(mnemonic, new Uint8Array(16).fill(0x01)),
      deriveRecoveryVerifier(mnemonic, new Uint8Array(16).fill(0x02)),
    ])

    expect(a).not.toEqual(b)
  })

  it('zera os bytes da frase depois de derivar, também quando a derivação falha', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    await deriveRecoveryVerifier(mnemonic, new Uint8Array(16).fill(0x02))
    const usados = vi.mocked(deriveKey).mock.lastCall![0]
    expect(usados).toHaveLength(new TextEncoder().encode(mnemonic).length)
    expect(usados.every((byte) => byte === 0)).toBe(true)

    vi.mocked(deriveKey).mockRejectedValueOnce(new Error('argon2'))
    await expect(deriveRecoveryVerifier(mnemonic, new Uint8Array(16))).rejects.toThrow('argon2')
    expect(vi.mocked(deriveKey).mock.lastCall![0].every((byte) => byte === 0)).toBe(true)
  })
})
