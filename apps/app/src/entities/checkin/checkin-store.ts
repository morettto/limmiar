import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import type { CheckIn } from './checkin'

// Same key-naming convention as key-store.ts's COPILOT_KEY_STORAGE_KEY.
export const CHECKIN_STORAGE_KEY_PREFIX = 'limmiar:checkin'
const AAD_PREFIX = 'limmiar/checkin/v1|'

// Shared entry guard, same rationale as key-store.ts's assertAccountId: namespaces the storage
// slot and the AAD by accountId, rejected once here instead of trusting every call site.
function assertAccountId(accountId: string): void {
  if (accountId === '') {
    throw new Error('checkin-store: accountId must not be empty')
  }
}

function storageKeyFor(accountId: string): string {
  return `${CHECKIN_STORAGE_KEY_PREFIX}:${accountId}`
}

function checkinAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${AAD_PREFIX}${accountId}`)
}

interface StoredEnvelope {
  wrappedDek: string
  ciphertext: string
}

/** [] quando nada foi gravado ainda para esta conta. */
export async function lerCheckIns(kek: CryptoKey, accountId: string): Promise<CheckIn[]> {
  assertAccountId(accountId)
  const raw = window.localStorage.getItem(storageKeyFor(accountId))
  if (raw === null) {
    return []
  }

  const stored = JSON.parse(raw) as StoredEnvelope
  const aad = checkinAad(accountId)
  const dek = await webcrypto.unwrapDek(kek, decodeBase64(stored.wrappedDek), aad)
  const plaintext = await webcrypto.decrypt(dek, decodeBase64(stored.ciphertext), aad)
  return JSON.parse(new TextDecoder().decode(plaintext)) as CheckIn[]
}

/**
 * Um envelope por conta com o array inteiro (não um por dia -- as datas também são dado do
 * paciente). DEK nova a cada escrita. Um check-in no mesmo dia substitui o anterior; dias
 * diferentes acumulam.
 */
export async function guardarCheckIn(kek: CryptoKey, accountId: string, checkin: CheckIn): Promise<void> {
  assertAccountId(accountId)
  const existentes = await lerCheckIns(kek, accountId)
  const proximos = [...existentes.filter((existente) => existente.dia !== checkin.dia), checkin]

  const aad = checkinAad(accountId)
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, aad)
  const plaintext = new TextEncoder().encode(JSON.stringify(proximos))
  const ciphertext = await webcrypto.encrypt(dek, plaintext, aad)

  const stored: StoredEnvelope = { wrappedDek: encodeBase64(wrapped), ciphertext: encodeBase64(ciphertext) }
  window.localStorage.setItem(storageKeyFor(accountId), JSON.stringify(stored))
}
