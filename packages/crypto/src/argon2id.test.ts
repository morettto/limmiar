import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveKey } from './argon2id'

// RFC 9106 §5.3 "Test Vectors" — Argon2id, https://www.rfc-editor.org/rfc/rfc9106#section-5.3
// password: 32× 0x01, salt: 16× 0x02, secret: 8× 0x03, associated data: 12× 0x04,
// m=32 KiB, t=3, p=4, dkLen=32, version 0x13. Cross-checked byte-for-byte against
// the installed @noble/hashes argon2idAsync output before being hardcoded here.
const RFC9106_TAG_HEX = '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659'

describe('deriveKey — RFC 9106 §5.3 known-answer test', () => {
  it('matches the official Argon2id test vector byte-for-byte', async () => {
    const password = new Uint8Array(32).fill(0x01)
    const salt = new Uint8Array(16).fill(0x02)
    const key = new Uint8Array(8).fill(0x03)
    const associatedData = new Uint8Array(12).fill(0x04)

    const result = await deriveKey(password, salt, {
      memoryKiB: 32,
      iterations: 3,
      parallelism: 4,
      dkLen: 32,
      key,
      associatedData,
    })

    expect(result).toEqual(Uint8Array.from(Buffer.from(RFC9106_TAG_HEX, 'hex')))
  })
})

describe('deriveKey — determinism', () => {
  it('returns identical output for identical password, salt and params across two independent calls', async () => {
    const password = new Uint8Array([1, 2, 3, 4])
    const salt = new Uint8Array(8).fill(9)
    const params = { memoryKiB: 8, iterations: 1, parallelism: 1 }

    const [a, b] = await Promise.all([deriveKey(password, salt, params), deriveKey(password, salt, params)])

    expect(a).toEqual(b)
  })
})

describe('deriveKey — dkLen', () => {
  it('produces output of a requested non-default length', async () => {
    const password = new Uint8Array([1, 2, 3, 4])
    const salt = new Uint8Array(8).fill(9)

    const result = await deriveKey(password, salt, { memoryKiB: 8, iterations: 1, parallelism: 1, dkLen: 16 })

    expect(result).toHaveLength(16)
  })
})

describe('deriveKey — memoryKiB validation (RFC 9106 §3.1: m must be >= 8*p)', () => {
  const password = new Uint8Array([1])
  const salt = new Uint8Array(8).fill(1)

  it('rejects before ever calling the library when memoryKiB is below 8*parallelism', async () => {
    // Exact message (not a loose substring): @noble/hashes has its own m>=8*p
    // check with different wording, so a weak assertion here would still pass
    // if this package's own guard were deleted and the library's fallback
    // error fired instead — the point of this test is that THIS guard fires.
    await expect(deriveKey(password, salt, { memoryKiB: 15, iterations: 1, parallelism: 2 })).rejects.toThrow(
      'Argon2Params.memoryKiB (15) must be at least 8 * parallelism (16)',
    )
  })

  it('accepts memoryKiB exactly equal to 8*parallelism (boundary)', async () => {
    await expect(
      deriveKey(password, salt, { memoryKiB: 16, iterations: 1, parallelism: 2 }),
    ).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('deriveKey — iterations validation', () => {
  const password = new Uint8Array([1])
  const salt = new Uint8Array(8).fill(1)

  it('rejects iterations below 1', async () => {
    // Exact message, same reasoning as the memoryKiB test above: @noble/hashes
    // also rejects t<1 on its own, with wording that happens to contain the
    // word "iterations" too, so only an exact match on this guard's specific
    // message proves this guard — not the library's — is what fired.
    await expect(
      deriveKey(password, salt, { memoryKiB: 8, iterations: 0, parallelism: 1 }),
    ).rejects.toThrow('Argon2Params.iterations (0) must be >= 1')
  })

  it('accepts iterations exactly 1 (boundary)', async () => {
    await expect(
      deriveKey(password, salt, { memoryKiB: 8, iterations: 1, parallelism: 1 }),
    ).resolves.toBeInstanceOf(Uint8Array)
  })
})

describe('deriveKey — ADR-S01-01 source guard (async-only Argon2id)', () => {
  it('imports argon2idAsync and never references the bare sync argon2id export', () => {
    const source = readFileSync(new URL('./argon2id.ts', import.meta.url), 'utf8')

    expect(source).toMatch(/\bargon2idAsync\b/)
    expect(source).not.toMatch(/\bargon2id\b/)
  })
})
