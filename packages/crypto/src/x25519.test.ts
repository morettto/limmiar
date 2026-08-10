import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { generateKeyPair, getPublicKey, getSharedSecret } from './x25519'

// RFC 7748 §5.2 "Test Vectors" — X25519 raw scalarmult (input scalar k, input
// u-coordinate, output u-coordinate), https://www.rfc-editor.org/rfc/rfc7748#section-5.2
// Cross-checked byte-for-byte against the installed @noble/curves x25519
// output (both scalarMult() and getSharedSecret()) before being hardcoded here.
const RFC7748_SCALARMULT_VECTOR = {
  k: 'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4',
  u: 'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c',
  output: 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552',
}

describe('getSharedSecret — RFC 7748 §5.2 known-answer test', () => {
  it('matches the official X25519 scalarmult test vector byte-for-byte', () => {
    const k = hexToBytes(RFC7748_SCALARMULT_VECTOR.k)
    const u = hexToBytes(RFC7748_SCALARMULT_VECTOR.u)

    const result = getSharedSecret(k, u)

    expect(bytesToHex(result)).toBe(RFC7748_SCALARMULT_VECTOR.output)
  })
})

// RFC 7748 §6.1 "Diffie-Hellman" — Alice/Bob key exchange example,
// https://www.rfc-editor.org/rfc/rfc7748#section-6.1
// Cross-checked byte-for-byte against the installed @noble/curves x25519
// output (getPublicKey and getSharedSecret, both directions) before being
// hardcoded here.
const RFC7748_DH_VECTOR = {
  alicePrivate: '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
  alicePublic: '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
  bobPrivate: '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
  bobPublic: 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
  sharedSecret: '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742',
}

describe('getPublicKey — RFC 7748 §6.1 known-answer test', () => {
  it("derives Alice's official public key from her official private key", () => {
    const result = getPublicKey(hexToBytes(RFC7748_DH_VECTOR.alicePrivate))

    expect(bytesToHex(result)).toBe(RFC7748_DH_VECTOR.alicePublic)
  })

  it("derives Bob's official public key from his official private key", () => {
    const result = getPublicKey(hexToBytes(RFC7748_DH_VECTOR.bobPrivate))

    expect(bytesToHex(result)).toBe(RFC7748_DH_VECTOR.bobPublic)
  })
})

describe('getSharedSecret — RFC 7748 §6.1 known-answer test, both directions', () => {
  it("matches the official shared secret computed from Alice's private key and Bob's public key", () => {
    const result = getSharedSecret(
      hexToBytes(RFC7748_DH_VECTOR.alicePrivate),
      hexToBytes(RFC7748_DH_VECTOR.bobPublic),
    )

    expect(bytesToHex(result)).toBe(RFC7748_DH_VECTOR.sharedSecret)
  })

  it("matches the official shared secret computed from Bob's private key and Alice's public key", () => {
    const result = getSharedSecret(
      hexToBytes(RFC7748_DH_VECTOR.bobPrivate),
      hexToBytes(RFC7748_DH_VECTOR.alicePublic),
    )

    expect(bytesToHex(result)).toBe(RFC7748_DH_VECTOR.sharedSecret)
  })
})

describe('generateKeyPair', () => {
  it('returns a 32-byte privateKey and a 32-byte publicKey', () => {
    const { privateKey, publicKey } = generateKeyPair()

    expect(privateKey).toHaveLength(32)
    expect(publicKey).toHaveLength(32)
  })

  it('returns a publicKey that is the X25519 public key for the returned privateKey', () => {
    const { privateKey, publicKey } = generateKeyPair()

    expect(getPublicKey(privateKey)).toEqual(publicKey)
  })

  it('returns different key pairs on successive calls', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()

    expect(a.privateKey).not.toEqual(b.privateKey)
  })
})

describe('getSharedSecret — ECDH symmetry property', () => {
  it('produces the same shared secret from both sides, for any two X25519 private keys', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (alicePrivateKey, bobPrivateKey) => {
          const alicePublicKey = getPublicKey(alicePrivateKey)
          const bobPublicKey = getPublicKey(bobPrivateKey)

          const fromAlice = getSharedSecret(alicePrivateKey, bobPublicKey)
          const fromBob = getSharedSecret(bobPrivateKey, alicePublicKey)

          expect(fromAlice).toEqual(fromBob)
        },
      ),
    )
  })
})

describe('getSharedSecret — degenerate (all-zero) peer public key', () => {
  // RFC 7748 §6.1: an all-zero output (which an all-zero, order-1 peer
  // public key always produces) MUST be rejected — accepting it would let a
  // malicious peer force a shared secret of zero, known in advance to
  // anyone. @noble/curves already enforces this itself; this test locks
  // that library behavior in as an invariant this package relies on,
  // instead of adding a second, unreachable guard of our own that no
  // mutation test could ever prove necessary.
  it('throws instead of returning an all-zero shared secret', () => {
    const { privateKey } = generateKeyPair()
    const allZeroPeerPublicKey = new Uint8Array(32)

    expect(() => getSharedSecret(privateKey, allZeroPeerPublicKey)).toThrow()
  })
})
