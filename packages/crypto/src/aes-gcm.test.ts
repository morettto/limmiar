import { readFileSync } from 'node:fs'
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { __resetNonceSourceForTests, __setNonceSourceForTests, decrypt, encrypt } from './aes-gcm'

// NIST CAVP GCM Decrypt with keysize 256 (CAVS 14.0, 2012-08-31), section
// [Keylen=256][IVlen=96][PTlen=128][AADlen=128][Taglen=128] Count 0, cross-checked
// against @noble/ciphers: https://raw.githubusercontent.com/mko-x/SharedAES-GCM/master/Sources/gcm_test_vectors/gcmDecrypt256.rsp
const NIST_CAVP_VECTOR = {
  key: '54e352ea1d84bfe64a1011096111fbe7668ad2203d902a01458c3bbd85bfce14',
  iv: 'df7c3bca00396d0c018495d9',
  aad: '7e968d71b50c1f11fd001f3fef49d045',
  pt: '85fc3dfad9b5a8d3258e4fc44571bd3b',
  ctWithTag: '426e0efc693b7be1f3018db7ddbb7e4dee8257795be6a1164d7e1d2d6cac77a7',
}

describe('encrypt/decrypt — basic round trip', () => {
  it('decrypts what it encrypted, for a simple non-empty plaintext', () => {
    const key = new Uint8Array(32).fill(0x01)
    const plaintext = new TextEncoder().encode('segredo do paciente')
    const aad = new Uint8Array([1, 2, 3])

    const ciphertext = encrypt(key, plaintext, aad)
    const decrypted = decrypt(key, ciphertext, aad)

    expect(decrypted).toEqual(plaintext)
  })
})

describe('encrypt — NIST CAVP known-answer test', () => {
  afterEach(() => {
    __resetNonceSourceForTests()
  })

  it('produces nonce || ciphertext || tag matching the official vector byte-for-byte', () => {
    const key = hexToBytes(NIST_CAVP_VECTOR.key)
    const aad = hexToBytes(NIST_CAVP_VECTOR.aad)
    const plaintext = hexToBytes(NIST_CAVP_VECTOR.pt)
    const iv = hexToBytes(NIST_CAVP_VECTOR.iv)

    // Pin the internally-generated nonce to the vector's IV so the output is
    // byte-comparable to the official ciphertext+tag. ADR-S01-02's test seam: the
    // nonce source is swappable here, never a parameter of encrypt().
    __setNonceSourceForTests(() => iv)

    const result = encrypt(key, plaintext, aad)

    expect(bytesToHex(result)).toBe(NIST_CAVP_VECTOR.iv + NIST_CAVP_VECTOR.ctWithTag)
  })

  it('decrypt() recovers the official plaintext from nonce || ciphertext || tag', () => {
    const key = hexToBytes(NIST_CAVP_VECTOR.key)
    const aad = hexToBytes(NIST_CAVP_VECTOR.aad)
    const blob = hexToBytes(NIST_CAVP_VECTOR.iv + NIST_CAVP_VECTOR.ctWithTag)

    const result = decrypt(key, blob, aad)

    expect(bytesToHex(result)).toBe(NIST_CAVP_VECTOR.pt)
  })

  it('__resetNonceSourceForTests() actually restores the CSPRNG-backed default, not the pinned vector nonce', () => {
    const key = hexToBytes(NIST_CAVP_VECTOR.key)
    const aad = hexToBytes(NIST_CAVP_VECTOR.aad)
    const plaintext = hexToBytes(NIST_CAVP_VECTOR.pt)
    const iv = hexToBytes(NIST_CAVP_VECTOR.iv)

    __setNonceSourceForTests(() => iv)
    __resetNonceSourceForTests()

    const result = encrypt(key, plaintext, aad)
    const resultNonce = bytesToHex(result).slice(0, NIST_CAVP_VECTOR.iv.length)

    expect(resultNonce).not.toBe(NIST_CAVP_VECTOR.iv)
  })
})

describe('encrypt/decrypt — AES-256 key length validation', () => {
  // @noble/ciphers gcm() accepts 16/24/32-byte keys; this module's contract is
  // AES-256-GCM, so a non-32-byte key must be rejected rather than silently
  // downgrading to AES-128/192.
  it('rejects an encrypt() key that is not 32 bytes', () => {
    const key = new Uint8Array(16).fill(0x01)
    const plaintext = new Uint8Array([1])
    const aad = new Uint8Array()

    expect(() => encrypt(key, plaintext, aad)).toThrow('AES-256-GCM key must be exactly 32 bytes, got 16')
  })

  it('rejects a decrypt() key that is not 32 bytes', () => {
    const key = new Uint8Array(24).fill(0x01)
    const ciphertext = new Uint8Array(28) // any blob — should reject before touching it
    const aad = new Uint8Array()

    expect(() => decrypt(key, ciphertext, aad)).toThrow('AES-256-GCM key must be exactly 32 bytes, got 24')
  })
})

describe('encrypt/decrypt — round-trip property', () => {
  it('decrypt(encrypt(key, x, aad), aad) === x for any plaintext (including empty), any key content, any AAD length', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ maxLength: 256 }), // plaintext, includes length-0
        fc.uint8Array({ maxLength: 64 }), // AAD, includes length-0
        (key, plaintext, aad) => {
          const ciphertext = encrypt(key, plaintext, aad)
          const decrypted = decrypt(key, ciphertext, aad)
          expect(decrypted).toEqual(plaintext)
        },
      ),
    )
  })
})

describe('encrypt/decrypt — bit-flip invalidates the tag', () => {
  it('flipping any single bit of the ciphertext blob always makes decrypt() throw', () => {
    const key = new Uint8Array(32).fill(0x07)
    const plaintext = new TextEncoder().encode('nota clinica confidencial')
    const aad = new Uint8Array([9, 9, 9])
    const original = encrypt(key, plaintext, aad)

    expect(original.length).toBeGreaterThan(0)

    for (let byteIndex = 0; byteIndex < original.length; byteIndex++) {
      for (let bit = 0; bit < 8; bit++) {
        const tampered = Uint8Array.from(original)
        tampered[byteIndex] = (tampered[byteIndex] as number) ^ (1 << bit)

        expect(() => decrypt(key, tampered, aad)).toThrow()
      }
    }
  })
})

describe('encrypt/decrypt — ADR-S01-02 source guard (nonce never a public parameter)', () => {
  it('declares encrypt/decrypt with exactly (key, plaintext|ciphertext, aad) — no nonce parameter', () => {
    const source = readFileSync(new URL('./aes-gcm.ts', import.meta.url), 'utf8')

    const encryptSignature = source.match(/export function encrypt\(([^)]*)\)/)
    const decryptSignature = source.match(/export function decrypt\(([^)]*)\)/)

    expect(encryptSignature).not.toBeNull()
    expect(decryptSignature).not.toBeNull()

    const encryptParams = encryptSignature?.[1] ?? ''
    const decryptParams = decryptSignature?.[1] ?? ''

    expect(encryptParams).not.toMatch(/nonce/i)
    expect(decryptParams).not.toMatch(/nonce/i)
    // Positive shape check too, so a signature that merely drops "nonce" from
    // an unrelated 4th param wouldn't slip through unnoticed.
    expect(encryptParams.split(',').map((p) => p.trim())).toHaveLength(3)
    expect(decryptParams.split(',').map((p) => p.trim())).toHaveLength(3)
  })
})
