// Re-exported under the local name WebCryptoKey (index.ts renames it back to CryptoKey) because `export type CryptoKey = CryptoKey` would be self-referential: a local declaration named CryptoKey shadows the ambient lib.dom/@types-node global for the whole module, so the RHS would resolve to itself.
export type WebCryptoKey = CryptoKey

const AES_256_KEY_LENGTH = 32
const GCM_IV_LENGTH = 12
const GCM_TAG_LENGTH_BITS = 128

// Same rationale as aes-gcm.ts's key-length guard: subtle.importKey silently accepts 16/24-byte input as AES-128/192-GCM, but this package's contract is AES-256-GCM only.
function assertAes256KeyLength(key: Uint8Array<ArrayBuffer>): void {
  if (key.length !== AES_256_KEY_LENGTH) {
    throw new Error(`AES-256-GCM key must be exactly ${AES_256_KEY_LENGTH} bytes, got ${key.length}`)
  }
}

// Return type pinned to Uint8Array<ArrayBuffer>, not the wider default Uint8Array<ArrayBufferLike>, so every value handed to crypto.subtle.* satisfies lib.dom's BufferSource, which since TS 5.7 no longer structurally accepts ArrayBufferLike.
function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

type IvSourceFn = () => Uint8Array<ArrayBuffer>

function randomIv(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH))
}

// ADR-S01-02 applies here too: IV/nonce is never a public parameter of encrypt()/generateWrappedDek()/rewrapDek(), generated internally and prepended to the returned blob; this seam exists only so KAT tests can pin the IV, production always resolves to randomIv().
let ivSource: IvSourceFn = randomIv

/** @internal test-only seam — not re-exported from the package barrel. */
export function __setIvSourceForTests(fn: IvSourceFn): void {
  ivSource = fn
}

/** @internal test-only seam — restores the CSPRNG-backed default. */
export function __resetIvSourceForTests(): void {
  ivSource = randomIv
}

// Imports as non-extractable, scoped to wrapKey/unwrapKey only (a KEK never encrypts application data directly). Zeroes `rawKek` in place as its last step, so the caller's copy cannot outlive the import.
export async function importKek(rawKek: Uint8Array<ArrayBuffer>): Promise<WebCryptoKey> {
  assertAes256KeyLength(rawKek)
  const kek = await crypto.subtle.importKey('raw', rawKek, { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey'])
  rawKek.fill(0)
  return kek
}

// subtle.wrapKey() requires an extractable key, so this generates an extractable DEK, wraps it, then re-derives a NON-extractable handle from the same bytes via unwrapKey(); the extractable handle never crosses this function's return boundary.
export async function generateWrappedDek(
  kek: WebCryptoKey,
  aad: Uint8Array<ArrayBuffer>,
): Promise<{ dek: WebCryptoKey; wrapped: Uint8Array<ArrayBuffer> }> {
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

// No manual length pre-check on `wrapped` — subtle.unwrapKey() itself fails closed on a too-short/truncated blob, same philosophy as aes-gcm.ts not duplicating validation the underlying primitive already performs.
export async function unwrapDek(
  kek: WebCryptoKey,
  wrapped: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<WebCryptoKey> {
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

// Re-wraps a DEK blob under a new KEK without ever exposing its raw bytes; the extractable intermediate handle produced by unwrapKey() here never leaves this function.
export async function rewrapDek(
  oldKek: WebCryptoKey,
  newKek: WebCryptoKey,
  wrapped: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
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

// Wire format: iv(12) || ciphertext || tag(16).
export async function encrypt(
  dek: WebCryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = ivSource()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    dek,
    plaintext,
  )
  return concat(iv, new Uint8Array(ciphertext))
}

// No manual length pre-check — subtle fails closed on malformed input.
export async function decrypt(
  dek: WebCryptoKey,
  ciphertext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = ciphertext.slice(0, GCM_IV_LENGTH)
  const body = ciphertext.slice(GCM_IV_LENGTH)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_LENGTH_BITS },
    dek,
    body,
  )
  return new Uint8Array(plaintext)
}
