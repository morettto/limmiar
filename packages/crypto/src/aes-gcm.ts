import { gcm } from '@noble/ciphers/aes.js'
import { managedNonce, randomBytes } from '@noble/ciphers/utils.js'

type RandomBytesFn = typeof randomBytes

// Test-only seam for the nonce's entropy source. Deliberately NOT a
// parameter of encrypt()/decrypt() — see ADR-S01-02: GCM nonce reuse is
// catastrophic and silent, so the only reliable defense is keeping it out of
// the public API entirely. This module-private binding exists solely so the
// KAT test can pin the NIST vector's exact nonce; production code always
// resolves to the default, CSPRNG-backed randomBytes below.
let nonceSource: RandomBytesFn = randomBytes

/** @internal test-only seam — not re-exported from the package barrel. */
export function __setNonceSourceForTests(fn: RandomBytesFn): void {
  nonceSource = fn
}

/** @internal test-only seam — restores the CSPRNG-backed default. */
export function __resetNonceSourceForTests(): void {
  nonceSource = randomBytes
}

const AES_256_KEY_LENGTH = 32

// @noble/ciphers' gcm() accepts any of the three standard AES key sizes
// (16/24/32 bytes) and would silently run as AES-128/192-GCM for a
// shorter key. This module's contract is specifically AES-256-GCM, so a
// wrong-length key is rejected here before it ever reaches the library.
function assertAes256KeyLength(key: Uint8Array): void {
  if (key.length !== AES_256_KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be exactly ${AES_256_KEY_LENGTH} bytes, got ${key.length}`)
  }
}

// ADR-S01-02: nonce reuse under AES-GCM is a catastrophic, silent failure —
// the only reliable defense is making it inexpressible in the public API.
// encrypt/decrypt below never take a nonce parameter; @noble/ciphers'
// managedNonce() generates one per call from a CSPRNG, prepends it to the
// returned ciphertext, and strips it back off on decrypt.
export function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  assertAes256KeyLength(key)
  return managedNonce(gcm, nonceSource)(key, aad).encrypt(plaintext)
}

export function decrypt(key: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  assertAes256KeyLength(key)
  return managedNonce(gcm, nonceSource)(key, aad).decrypt(ciphertext)
}
