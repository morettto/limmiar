import type { webcrypto } from 'node:crypto'

export type CryptoKey = webcrypto.CryptoKey

const AES_256_KEY_LENGTH = 32
const GCM_IV_LENGTH = 12
const GCM_TAG_LENGTH_BITS = 128

// Same rationale as aes-gcm.ts's key-length guard: subtle.importKey silently
// accepts 16/24-byte input as AES-128/192-GCM. This package's contract is
// specifically AES-256-GCM.
function assertAes256KeyLength(key: Uint8Array): void {
  if (key.length !== AES_256_KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be exactly ${AES_256_KEY_LENGTH} bytes, got ${key.length}`)
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

type IvSourceFn = () => Uint8Array

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH))
}

// ADR-S01-02 applies to this module too: IV/nonce is never a public
// parameter of encrypt()/generateWrappedDek()/rewrapDek() — generated
// internally and prepended to the returned blob. This seam exists solely so
// KAT tests can pin the IV; production code always resolves to randomIv().
let ivSource: IvSourceFn = randomIv

/** @internal test-only seam — not re-exported from the package barrel. */
export function __setIvSourceForTests(fn: IvSourceFn): void {
  ivSource = fn
}

/** @internal test-only seam — restores the CSPRNG-backed default. */
export function __resetIvSourceForTests(): void {
  ivSource = randomIv
}

/**
 * Imports raw KEK bytes as a non-extractable CryptoKey scoped to
 * wrapKey/unwrapKey only — a KEK never encrypts application data directly,
 * it only ever (un)wraps DEKs (see dek-kek.ts for the equivalent raw-bytes
 * semantics). Mutates `rawKek` (zeroes it in place) as its last step, so the
 * caller's copy of the raw KEK cannot outlive the import — precedent:
 * keychain.ts's lock() self-zeroes the KEK it owns rather than trusting a
 * caller to do it.
 */
export async function importKek(rawKek: Uint8Array): Promise<CryptoKey> {
  assertAes256KeyLength(rawKek)
  const kek = await crypto.subtle.importKey('raw', rawKek, { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey'])
  rawKek.fill(0)
  return kek
}

/**
 * Generates a fresh DEK and returns it already wrapped under `kek`, as an
 * atomic operation. subtle.wrapKey() requires the key being wrapped to be
 * extractable, so a standalone generateDek() returning a non-extractable key
 * could never subsequently be wrapped — this function generates an
 * extractable DEK in a local variable, wraps it, then immediately re-derives
 * a fresh NON-extractable handle from the same bytes via unwrapKey(). The
 * extractable handle never crosses this function's return boundary.
 */
export async function generateWrappedDek(
  kek: CryptoKey,
  aad: Uint8Array,
): Promise<{ dek: CryptoKey; wrapped: Uint8Array }> {
  const extractableDek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const iv = ivSource()
  const wrappedBody = await crypto.subtle.wrapKey('raw', extractableDek, kek, {
    name: 'AES-GCM',
    iv,
    additionalData: aad,
    tagLength: GCM_TAG_LENGTH_BITS,
  })
  const dek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedBody,
    kek,
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { dek, wrapped: concat(iv, new Uint8Array(wrappedBody)) }
}

/**
 * Unwraps a DEK blob produced by generateWrappedDek()/rewrapDek() into a
 * non-extractable CryptoKey. No manual length pre-check on `wrapped` —
 * subtle.unwrapKey() itself fails closed (rejects) on a too-short/truncated
 * blob, same philosophy as aes-gcm.ts not duplicating validation the
 * underlying primitive already performs.
 */
export async function unwrapDek(kek: CryptoKey, wrapped: Uint8Array, aad: Uint8Array): Promise<CryptoKey> {
  const iv = wrapped.slice(0, GCM_IV_LENGTH)
  const body = wrapped.slice(GCM_IV_LENGTH)
  return crypto.subtle.unwrapKey(
    'raw',
    body,
    kek,
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Re-wraps a DEK blob under a new KEK without ever exposing its raw bytes —
 * used when a professional changes their password (parent Spec's "Pronto
 * quando": password change rewraps DEKs without touching a single byte of
 * record data). The extractable intermediate handle produced by unwrapKey()
 * here never leaves this function.
 */
export async function rewrapDek(
  oldKek: CryptoKey,
  newKek: CryptoKey,
  wrapped: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const iv = wrapped.slice(0, GCM_IV_LENGTH)
  const body = wrapped.slice(GCM_IV_LENGTH)
  const extractableDek = await crypto.subtle.unwrapKey(
    'raw',
    body,
    oldKek,
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const newIv = ivSource()
  const newWrappedBody = await crypto.subtle.wrapKey('raw', extractableDek, newKek, {
    name: 'AES-GCM',
    iv: newIv,
    additionalData: aad,
    tagLength: GCM_TAG_LENGTH_BITS,
  })
  return concat(newIv, new Uint8Array(newWrappedBody))
}

/** Encrypts application data with a DEK CryptoKey. Wire format: iv(12) || ciphertext || tag(16). */
export async function encrypt(dek: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = ivSource()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    dek,
    plaintext,
  )
  return concat(iv, new Uint8Array(ciphertext))
}

/** Decrypts a blob produced by encrypt(). No manual length pre-check — subtle fails closed on malformed input. */
export async function decrypt(dek: CryptoKey, ciphertext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = ciphertext.slice(0, GCM_IV_LENGTH)
  const body = ciphertext.slice(GCM_IV_LENGTH)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    dek,
    body,
  )
  return new Uint8Array(plaintext)
}
