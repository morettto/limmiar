import { readFileSync } from 'node:fs'
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  __resetIvSourceForTests,
  __setIvSourceForTests,
  decrypt,
  encrypt,
  generateWrappedDek,
  importKek,
  rewrapDek,
  sha256,
  unwrapDek,
  type WebCryptoKey as CryptoKey,
} from './webcrypto'

// Same vendored NIST CAVP vector already cited in aes-gcm.test.ts — see that
// file for the full source citation. Reused here so both the @noble path and
// the native WebCrypto path are checked against the identical official vector.
const NIST_CAVP_VECTOR = {
  key: '54e352ea1d84bfe64a1011096111fbe7668ad2203d902a01458c3bbd85bfce14',
  iv: 'df7c3bca00396d0c018495d9',
  aad: '7e968d71b50c1f11fd001f3fef49d045',
  pt: '85fc3dfad9b5a8d3258e4fc44571bd3b',
  ctWithTag: '426e0efc693b7be1f3018db7ddbb7e4dee8257795be6a1164d7e1d2d6cac77a7',
}

// Test-only helper: importKek() scopes its output to wrapKey/unwrapKey (a KEK never
// encrypts application data), so a DEK-shaped key for encrypt()/decrypt() tests is
// built directly via subtle.importKey instead.
async function importRawDekForTests(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

describe('encrypt — WebCrypto native NIST CAVP known-answer test', () => {
  it('produces iv || ciphertext || tag matching the official vector byte-for-byte', async () => {
    const key = await importRawDekForTests(hexToBytes(NIST_CAVP_VECTOR.key))
    const aad = hexToBytes(NIST_CAVP_VECTOR.aad)
    const plaintext = hexToBytes(NIST_CAVP_VECTOR.pt)
    const iv = hexToBytes(NIST_CAVP_VECTOR.iv)

    // Pin the internally-generated IV to the vector's IV so the output is
    // byte-comparable — same seam discipline as aes-gcm.ts's nonce source
    // (ADR-S01-02 applies here too: IV is never a public parameter).
    __setIvSourceForTests(() => iv)
    try {
      const result = await encrypt(key, plaintext, aad)
      expect(bytesToHex(result)).toBe(NIST_CAVP_VECTOR.iv + NIST_CAVP_VECTOR.ctWithTag)
    } finally {
      __resetIvSourceForTests()
    }
  })

  it('decrypt() recovers the official plaintext from iv || ciphertext || tag', async () => {
    const key = await importRawDekForTests(hexToBytes(NIST_CAVP_VECTOR.key))
    const aad = hexToBytes(NIST_CAVP_VECTOR.aad)
    const blob = hexToBytes(NIST_CAVP_VECTOR.iv + NIST_CAVP_VECTOR.ctWithTag)

    const result = await decrypt(key, blob, aad)

    expect(bytesToHex(result)).toBe(NIST_CAVP_VECTOR.pt)
  })

  it('__resetIvSourceForTests() actually restores the CSPRNG-backed default, not the pinned vector IV', async () => {
    const key = await importRawDekForTests(hexToBytes(NIST_CAVP_VECTOR.key))
    const aad = hexToBytes(NIST_CAVP_VECTOR.aad)
    const plaintext = hexToBytes(NIST_CAVP_VECTOR.pt)
    const iv = hexToBytes(NIST_CAVP_VECTOR.iv)

    __setIvSourceForTests(() => iv)
    __resetIvSourceForTests()

    const result = await encrypt(key, plaintext, aad)
    const resultIv = bytesToHex(result).slice(0, NIST_CAVP_VECTOR.iv.length)

    expect(resultIv).not.toBe(NIST_CAVP_VECTOR.iv)
  })
})

describe('importKek', () => {
  it('rejects a key that is not 32 bytes', async () => {
    await expect(importKek(new Uint8Array(16).fill(0x01))).rejects.toThrow(
      'AES-256-GCM key must be exactly 32 bytes, got 16',
    )
    await expect(importKek(new Uint8Array(24).fill(0x01))).rejects.toThrow(
      'AES-256-GCM key must be exactly 32 bytes, got 24',
    )
  })

  it('zeroes its argument in place after import', async () => {
    const raw = new Uint8Array(32).fill(7)

    await importKek(raw)

    expect(raw).toEqual(new Uint8Array(32))
  })

  it('returns a non-extractable key scoped to wrapKey/unwrapKey usages only', async () => {
    const kek = await importKek(new Uint8Array(32).fill(1))

    expect(kek.extractable).toBe(false)
    expect(kek.usages.sort()).toEqual(['unwrapKey', 'wrapKey'])
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toThrow()
  })

  it('cannot be used directly for encrypt/decrypt (usage-scoped least privilege)', async () => {
    const kek = await importKek(new Uint8Array(32).fill(1))
    const plaintext = new Uint8Array([1, 2, 3])

    await expect(crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, kek, plaintext)).rejects.toThrow()
  })
})

describe('generateWrappedDek / unwrapDek — round trip', () => {
  it('produces a DEK that decrypts what it encrypts, and a wrapped blob that unwraps back to an equivalent DEK', async () => {
    const kek = await importKek(new Uint8Array(32).fill(0x11))
    const aad = new TextEncoder().encode('schema=1;record=patient-A')

    const { dek, wrapped } = await generateWrappedDek(kek, aad)
    const plaintext = new TextEncoder().encode('nota clinica confidencial')
    const ciphertext = await encrypt(dek, plaintext, new Uint8Array())
    const decryptedWithOriginalDek = await decrypt(dek, ciphertext, new Uint8Array())

    const kek2 = await importKek(new Uint8Array(32).fill(0x11))
    const reunwrappedDek = await unwrapDek(kek2, wrapped, aad)
    const decryptedWithUnwrappedDek = await decrypt(reunwrappedDek, ciphertext, new Uint8Array())

    expect(decryptedWithOriginalDek).toEqual(plaintext)
    expect(decryptedWithUnwrappedDek).toEqual(plaintext)
  })

  it('returns a non-extractable dek scoped to encrypt/decrypt usages only, and a 60-byte wrapped blob', async () => {
    const kek = await importKek(new Uint8Array(32).fill(0x11))

    const { dek, wrapped } = await generateWrappedDek(kek, new Uint8Array())

    expect(dek.extractable).toBe(false)
    expect(dek.usages.sort()).toEqual(['decrypt', 'encrypt'])
    await expect(crypto.subtle.exportKey('raw', dek)).rejects.toThrow()
    expect(wrapped).toHaveLength(12 + 32 + 16)
  })

  it('unwrapDek also returns a non-extractable, encrypt/decrypt-scoped key', async () => {
    const kek = await importKek(new Uint8Array(32).fill(0x11))
    const aad = new Uint8Array()
    const { wrapped } = await generateWrappedDek(kek, aad)

    const kek2 = await importKek(new Uint8Array(32).fill(0x11))
    const unwrapped = await unwrapDek(kek2, wrapped, aad)

    expect(unwrapped.extractable).toBe(false)
    expect(unwrapped.usages.sort()).toEqual(['decrypt', 'encrypt'])
    await expect(crypto.subtle.exportKey('raw', unwrapped)).rejects.toThrow()
  })

  it('the returned dek cannot be used as a wrapKey/unwrapKey wrapping key', async () => {
    const kek = await importKek(new Uint8Array(32).fill(0x11))
    const { dek } = await generateWrappedDek(kek, new Uint8Array())
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

    await expect(
      crypto.subtle.wrapKey('raw', other, dek, { name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 128 }),
    ).rejects.toThrow()
  })
})

describe('generateWrappedDek / unwrapDek — property: round trip for any plaintext, AAD, and 32-byte KEK', () => {
  it('decrypt(encrypt(dek, x, aad2), aad2) === x, and unwrapDek recovers a functionally-equivalent dek, for any x (including empty) and any KEK', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ maxLength: 256 }),
        fc.uint8Array({ maxLength: 64 }),
        fc.uint8Array({ maxLength: 64 }),
        async (kekBytes, plaintext, wrapAad, dataAad) => {
          // importKek zeroes its argument in place — fast-check replays/shrinks
          // the same generated value across assertions, so each call needs its
          // own untouched copy.
          const kek = await importKek(kekBytes.slice())
          const { dek, wrapped } = await generateWrappedDek(kek, wrapAad)

          const ciphertext = await encrypt(dek, plaintext, dataAad)
          const decrypted = await decrypt(dek, ciphertext, dataAad)
          expect(decrypted).toEqual(plaintext)

          const kekForUnwrap = await importKek(kekBytes.slice())
          const unwrapped = await unwrapDek(kekForUnwrap, wrapped, wrapAad)
          const decryptedViaUnwrapped = await decrypt(unwrapped, ciphertext, dataAad)
          expect(decryptedViaUnwrapped).toEqual(plaintext)
        },
      ),
    )
  })
})

describe('unwrapDek — cross-KEK isolation', () => {
  it('rejects when unwrapped under a different KEK than the one that wrapped it', async () => {
    const kekA = await importKek(new Uint8Array(32).fill(0xaa))
    const kekB = await importKek(new Uint8Array(32).fill(0xbb))
    const aad = new Uint8Array()

    const { wrapped } = await generateWrappedDek(kekA, aad)

    await expect(unwrapDek(kekB, wrapped, aad)).rejects.toThrow()
  })
})

describe('unwrapDek — ADR-S01-03 parity: AAD binds the wrapped DEK to its context', () => {
  it('rejects when the AAD does not match the one used to wrap', async () => {
    const kek = await importKek(new Uint8Array(32).fill(0x33))
    const wrapAad = new TextEncoder().encode('schema=1;record=patient-A')
    const wrongAad = new TextEncoder().encode('schema=1;record=patient-B')

    const { wrapped } = await generateWrappedDek(kek, wrapAad)

    await expect(unwrapDek(kek, wrapped, wrongAad)).rejects.toThrow()
  })
})

describe('unwrapDek — malformed/truncated wrapped blob fails closed', () => {
  it.each([0, 1, 11, 12, 13, 59])('rejects a wrapped blob truncated to %i bytes', async (length) => {
    const kek = await importKek(new Uint8Array(32).fill(0x11))
    const aad = new Uint8Array()
    const { wrapped } = await generateWrappedDek(kek, aad)

    await expect(unwrapDek(kek, wrapped.slice(0, length), aad)).rejects.toThrow()
  })
})

describe('unwrapDek — bit-flip invalidates the tag', () => {
  it('flipping any single bit of the wrapped blob always makes unwrapDek() throw', async () => {
    const kek = await importKek(new Uint8Array(32).fill(0x07))
    const aad = new Uint8Array([9, 9, 9])
    const { wrapped } = await generateWrappedDek(kek, aad)

    for (let byteIndex = 0; byteIndex < wrapped.length; byteIndex++) {
      for (let bit = 0; bit < 8; bit++) {
        const tampered = Uint8Array.from(wrapped)
        tampered[byteIndex] = (tampered[byteIndex] as number) ^ (1 << bit)

        const kekForAttempt = await importKek(new Uint8Array(32).fill(0x07))
        await expect(unwrapDek(kekForAttempt, tampered, aad)).rejects.toThrow()
      }
    }
  })
})

describe('decrypt — bit-flip invalidates the tag', () => {
  it('flipping any single bit of the ciphertext blob always makes decrypt() throw', async () => {
    const key = await importRawDekForTests(new Uint8Array(32).fill(0x07))
    const plaintext = new TextEncoder().encode('nota clinica confidencial')
    const aad = new Uint8Array([9, 9, 9])
    const original = await encrypt(key, plaintext, aad)

    for (let byteIndex = 0; byteIndex < original.length; byteIndex++) {
      for (let bit = 0; bit < 8; bit++) {
        const tampered = Uint8Array.from(original)
        tampered[byteIndex] = (tampered[byteIndex] as number) ^ (1 << bit)

        await expect(decrypt(key, tampered, aad)).rejects.toThrow()
      }
    }
  })
})

describe('JSON.stringify never exposes key material', () => {
  it('serializes any CryptoKey produced by this module to an empty object, isolated, nested, and in an array', async () => {
    const kek = await importKek(new Uint8Array(32).fill(1))
    const { dek } = await generateWrappedDek(await importKek(new Uint8Array(32).fill(1)), new Uint8Array())

    expect(JSON.stringify(kek)).toBe('{}')
    expect(JSON.stringify(dek)).toBe('{}')
    expect(JSON.stringify({ dek })).toBe('{"dek":{}}')
    expect(JSON.stringify([dek, kek])).toBe('[{},{}]')
  })
})

describe('rewrapDek', () => {
  it('rewraps a DEK under a new KEK without touching the encrypted data, and the old KEK can no longer open it', async () => {
    const oldKek = await importKek(new Uint8Array(32).fill(0x01))
    const newKek = await importKek(new Uint8Array(32).fill(0x02))
    const aad = new TextEncoder().encode('schema=1;record=patient-A')

    const { dek, wrapped } = await generateWrappedDek(await importKek(new Uint8Array(32).fill(0x01)), aad)
    const plaintext = new TextEncoder().encode('prontuario')
    const ciphertext = await encrypt(dek, plaintext, new Uint8Array())

    const rewrapped = await rewrapDek(oldKek, newKek, wrapped, aad)

    const dekViaNewKek = await unwrapDek(await importKek(new Uint8Array(32).fill(0x02)), rewrapped, aad)
    const decrypted = await decrypt(dekViaNewKek, ciphertext, new Uint8Array())
    expect(decrypted).toEqual(plaintext)

    await expect(unwrapDek(await importKek(new Uint8Array(32).fill(0x01)), rewrapped, aad)).rejects.toThrow()
  })
})

describe('sha256 — NIST FIPS 180-4 known-answer test', () => {
  it('hashes the empty message to the well-known constant', async () => {
    const result = await sha256(new Uint8Array())

    expect(bytesToHex(result)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes "abc" to the well-known FIPS 180-4 vector', async () => {
    const result = await sha256(new TextEncoder().encode('abc'))

    expect(bytesToHex(result)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('source guards', () => {
  const source = readFileSync(new URL('./webcrypto.ts', import.meta.url), 'utf8')

  it('no exported function signature takes iv/nonce/extractable as a parameter', () => {
    const exportedFunctionSignatures = [...source.matchAll(/export (?:async )?function \w+\(([^)]*)\)/g)].map(
      (match) => match[1] ?? '',
    )

    expect(exportedFunctionSignatures.length).toBeGreaterThan(0)
    for (const params of exportedFunctionSignatures) {
      expect(params).not.toMatch(/\b(iv|nonce|extractable)\b/i)
    }
  })

  it('production code never calls subtle.exportKey', () => {
    expect(source).not.toMatch(/\.exportKey\(/)
  })
})
