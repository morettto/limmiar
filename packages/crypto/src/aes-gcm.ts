import { gcm } from '@noble/ciphers/aes.js'
import { managedNonce, randomBytes } from '@noble/ciphers/utils.js'

type RandomBytesFn = typeof randomBytes

// Test-only seam for the nonce source, deliberately not a param of encrypt()/decrypt() (ADR-S01-02: GCM nonce reuse is catastrophic, so it must stay out of the public API); only the KAT test overrides it, production always uses the CSPRNG-backed randomBytes below.
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

// @noble/ciphers' gcm() silently accepts a 16/24-byte key as AES-128/192-GCM; this module's contract is AES-256-GCM only, so a wrong-length key is rejected before reaching the library.
function assertAes256KeyLength(key: Uint8Array): void {
  if (key.length !== AES_256_KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be exactly ${AES_256_KEY_LENGTH} bytes, got ${key.length}`)
  }
}

// ADR-S01-02: encrypt/decrypt never take a nonce parameter; managedNonce() generates one per call from a CSPRNG, prepends it to the ciphertext, and strips it back off on decrypt.
export function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  assertAes256KeyLength(key)
  return managedNonce(gcm, nonceSource)(key, aad).encrypt(plaintext)
}

export function decrypt(key: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  assertAes256KeyLength(key)
  return managedNonce(gcm, nonceSource)(key, aad).decrypt(ciphertext)
}
