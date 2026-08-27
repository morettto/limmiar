import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { copilotDekAad, copilotKeyAad } from './copilot-crypto'

// Same key-naming convention as locale/local-storage-locale-store.ts's LOCALE_STORAGE_KEY.
export const COPILOT_KEY_STORAGE_KEY = 'limmiar:copilot-key'

interface StoredCopilotKey {
  providerId: string
  wrappedDek: string
  ciphertext: string
}

/**
 * Plaintext, module-scoped, never written anywhere: the default (opt-in-only) home for the key.
 * Dropped on reload -- exactly what the spec calls for when the user has not asked to persist.
 */
let inMemoryKey: { accountId: string; providerId: string; apiKey: string } | null = null

// Shared entry guard: every one of saveApiKey/loadApiKey/clearApiKey namespaces its storage slot
// (and, for save/load, its AAD) by accountId. An empty accountId collapses that namespacing to a
// single slot shared by whoever else also forgot to pass one -- reject it once, here, at the top
// of each public function, instead of trusting every call site to have checked already.
function assertAccountId(accountId: string): void {
  if (accountId === '') {
    throw new Error('key-store: accountId must not be empty')
  }
}

function storageKeyFor(accountId: string): string {
  return `${COPILOT_KEY_STORAGE_KEY}:${accountId}`
}

/**
 * Always updates the in-memory copy (plaintext, this tab only). Only when `persist` is true does
 * it also envelope `apiKey` under a fresh per-secret DEK (wrapped by `kek`, same pattern as
 * patients/patient-crypto.ts's sealNewPatient) and write it to localStorage, namespaced by
 * `accountId` so two accounts on the same device never share -- and silently overwrite -- one
 * storage slot. The result never leaves the browser either way: never sent in a request to our
 * server.
 */
export async function saveApiKey(
  kek: CryptoKey,
  accountId: string,
  providerId: string,
  apiKey: string,
  persist: boolean,
): Promise<void> {
  assertAccountId(accountId)
  inMemoryKey = { accountId, providerId, apiKey }

  if (!persist) {
    // A prior save with persist=true may have left an envelope behind; opting out now must
    // not leave the old value loadable after a reload.
    window.localStorage.removeItem(storageKeyFor(accountId))
    return
  }

  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, copilotDekAad(accountId))
  const plaintext = new TextEncoder().encode(apiKey)
  const ciphertext = await webcrypto.encrypt(dek, plaintext, copilotKeyAad(accountId, providerId))

  const stored: StoredCopilotKey = {
    providerId,
    wrappedDek: encodeBase64(wrapped),
    ciphertext: encodeBase64(ciphertext),
  }
  window.localStorage.setItem(storageKeyFor(accountId), JSON.stringify(stored))
}

/** Returns null when nothing has been saved yet. Throws (AES-GCM tag failure) if `kek` does not match what the key was saved under. */
export async function loadApiKey(
  kek: CryptoKey,
  accountId: string,
): Promise<{ providerId: string; apiKey: string } | null> {
  assertAccountId(accountId)
  if (inMemoryKey !== null && inMemoryKey.accountId === accountId) {
    return { providerId: inMemoryKey.providerId, apiKey: inMemoryKey.apiKey }
  }

  const raw = window.localStorage.getItem(storageKeyFor(accountId))
  if (raw === null) {
    return null
  }

  const stored = JSON.parse(raw) as StoredCopilotKey
  const dek = await webcrypto.unwrapDek(kek, decodeBase64(stored.wrappedDek), copilotDekAad(accountId))
  const plaintext = await webcrypto.decrypt(
    dek,
    decodeBase64(stored.ciphertext),
    copilotKeyAad(accountId, stored.providerId),
  )
  const apiKey = new TextDecoder().decode(plaintext)
  inMemoryKey = { accountId, providerId: stored.providerId, apiKey }
  return { providerId: stored.providerId, apiKey }
}

export function clearApiKey(accountId: string): void {
  assertAccountId(accountId)
  if (inMemoryKey !== null && inMemoryKey.accountId === accountId) {
    inMemoryKey = null
  }
  window.localStorage.removeItem(storageKeyFor(accountId))
}
