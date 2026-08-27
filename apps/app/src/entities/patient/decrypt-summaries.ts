import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { patientDekAad, patientEntryAad } from './patient-crypto'
import { parseSummaryPlaintext, type SealedSummary, type SummaryResult } from './patient-summary'

// Only sequence 1 exists for a summary read (the creation entry) -- openRecord's 1..N
// contiguity check does not apply here, so this goes straight to unwrap+decrypt of that
// one entry instead of reusing openRecord.
async function decryptOne(kek: CryptoKey, item: SealedSummary): Promise<SummaryResult> {
  try {
    const dek = await webcrypto.unwrapDek(kek, item.wrappedDek, patientDekAad(item.patientId))
    const plaintext = await webcrypto.decrypt(dek, item.ciphertext, patientEntryAad(item.patientId, 1))
    const parsed = parseSummaryPlaintext(plaintext)
    if (parsed === null) {
      return { patientId: item.patientId, ok: false }
    }
    return { patientId: item.patientId, ok: true, name: parsed.name, risk: parsed.risk }
  } catch {
    // Never surface the crypto failure reason (wrong KEK vs tampered ciphertext vs
    // anything else) -- this item just failed to open.
    return { patientId: item.patientId, ok: false }
  }
}

/** One result per item, same order as `items`. A single item's failure never aborts the batch. */
export async function decryptSummaries(kek: CryptoKey, items: SealedSummary[]): Promise<SummaryResult[]> {
  return Promise.all(items.map((item) => decryptOne(kek, item)))
}
