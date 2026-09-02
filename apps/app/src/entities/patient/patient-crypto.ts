import { type CryptoKey, webcrypto } from '@limmiar/crypto'

// AAD is deliberately scoped to patientId (+ sequence for entries), never tenantId/professionalId:
// RLS already enforces tenant isolation at the DB layer, and keeping AAD narrow avoids forcing a
// ciphertext re-encrypt on future re-keying/transfer-of-care (ADR pending if one gets written).
const DEK_AAD_PREFIX = 'limmiar/patient-dek/v1|'
const ENTRY_AAD_PREFIX = 'limmiar/patient-entry/v1|'

export function patientDekAad(patientId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${DEK_AAD_PREFIX}${patientId}`)
}

export function patientEntryAad(patientId: string, sequence: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${ENTRY_AAD_PREFIX}${patientId}|${sequence}`)
}

/** Creates the patient's DEK and seals the sequence-1 (creation) entry under it. */
export async function sealNewPatient(
  kek: CryptoKey,
  patientId: string,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<{ wrappedDek: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer>; dek: CryptoKey }> {
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, patientDekAad(patientId))
  const ciphertext = await webcrypto.encrypt(dek, plaintext, patientEntryAad(patientId, 1))
  return { wrappedDek: wrapped, ciphertext, dek }
}

/** Seals a later (sequence > 1) prontuário entry under the patient's already-unwrapped DEK. */
export function sealEntry(
  dek: CryptoKey,
  patientId: string,
  sequence: number,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.encrypt(dek, plaintext, patientEntryAad(patientId, sequence))
}

/**
 * Unwraps the DEK and decrypts every entry in order. The AAD binds each ciphertext to its own
 * (patientId, sequence) but says nothing about a *missing* one, so the sequence run must be exactly
 * 1..N. Drops off the end still need entry-to-entry chaining, tracked as follow-up.
 */
export async function openRecord(
  kek: CryptoKey,
  record: { wrappedDek: Uint8Array<ArrayBuffer>; entries: { sequence: number; ciphertext: Uint8Array<ArrayBuffer> }[] },
  patientId: string,
): Promise<{ dek: CryptoKey; plaintexts: Uint8Array<ArrayBuffer>[] }> {
  const sorted = [...record.entries].sort((a, b) => a.sequence - b.sequence)
  sorted.forEach((entry, index) => {
    if (entry.sequence !== index + 1) {
      throw new Error(`patient record has a gap or duplicate at sequence ${index + 1} (got ${entry.sequence})`)
    }
  })

  const dek = await webcrypto.unwrapDek(kek, record.wrappedDek, patientDekAad(patientId))
  const plaintexts = await Promise.all(
    sorted.map((entry) => webcrypto.decrypt(dek, entry.ciphertext, patientEntryAad(patientId, entry.sequence))),
  )
  return { dek, plaintexts }
}
