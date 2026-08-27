import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { openRecord, patientDekAad, patientEntryAad, sealEntry, sealNewPatient } from './patient-crypto'

const PATIENT_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_PATIENT_ID = '22222222-2222-2222-2222-222222222222'

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

// No Node `Buffer` global -- this suite exercises SPA browser code, so it stays on
// platform primitives (jsdom happens to run in a Node process, but that's incidental).
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('patientDekAad / patientEntryAad', () => {
  it('builds the locked AAD strings as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(patientDekAad(PATIENT_ID))).toBe(`limmiar/patient-dek/v1|${PATIENT_ID}`)
    expect(new TextDecoder().decode(patientEntryAad(PATIENT_ID, 3))).toBe(`limmiar/patient-entry/v1|${PATIENT_ID}|3`)
  })
})

describe('sealNewPatient / openRecord', () => {
  it('produces ciphertext that does not contain the plaintext bytes', async () => {
    const kek = await makeKek()
    const plaintext = new TextEncoder().encode('nome: Maria da Silva; cpf: 000.000.000-00')

    const { ciphertext } = await sealNewPatient(kek, PATIENT_ID, plaintext)

    expect(toHex(ciphertext)).not.toContain(toHex(plaintext))
  })

  it('opens with the correct KEK and recovers the exact original plaintexts, in sequence order', async () => {
    const kek = await makeKek()
    const firstPlaintext = new TextEncoder().encode('entrada de criação')
    const secondPlaintext = new TextEncoder().encode('segunda entrada de prontuário')

    const sealed = await sealNewPatient(kek, PATIENT_ID, firstPlaintext)
    const secondCiphertext = await sealEntry(sealed.dek, PATIENT_ID, 2, secondPlaintext)

    const { plaintexts } = await openRecord(
      kek,
      {
        wrappedDek: sealed.wrappedDek,
        entries: [
          { sequence: 1, ciphertext: sealed.ciphertext },
          { sequence: 2, ciphertext: secondCiphertext },
        ],
      },
      PATIENT_ID,
    )

    expect(plaintexts).toHaveLength(2)
    expect(new TextDecoder().decode(plaintexts[0])).toBe('entrada de criação')
    expect(new TextDecoder().decode(plaintexts[1])).toBe('segunda entrada de prontuário')
  })

  it('throws when opened with the wrong KEK (AES-GCM tag failure)', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    const plaintext = new TextEncoder().encode('conteúdo clínico')
    const sealed = await sealNewPatient(kek, PATIENT_ID, plaintext)

    await expect(
      openRecord(
        wrongKek,
        { wrappedDek: sealed.wrappedDek, entries: [{ sequence: 1, ciphertext: sealed.ciphertext }] },
        PATIENT_ID,
      ),
    ).rejects.toThrow()
  })

  it('throws when one byte of the ciphertext is tampered with', async () => {
    const kek = await makeKek()
    const plaintext = new TextEncoder().encode('conteúdo clínico')
    const sealed = await sealNewPatient(kek, PATIENT_ID, plaintext)

    const tampered = new Uint8Array(sealed.ciphertext)
    tampered[tampered.length - 1] ^= 0xff

    await expect(
      openRecord(kek, { wrappedDek: sealed.wrappedDek, entries: [{ sequence: 1, ciphertext: tampered }] }, PATIENT_ID),
    ).rejects.toThrow()
  })

  // The reason the AAD exists: prove it actually binds ciphertext to context, not just that
  // encrypt/decrypt round-trips. A regression that swapped patientEntryAad(patientId, sequence)
  // for a constant would still pass every test above and would only fail here.
  it('throws when a sealed entry is opened under a different patientId', async () => {
    const kek = await makeKek()
    const plaintext = new TextEncoder().encode('conteúdo clínico')
    const sealed = await sealNewPatient(kek, PATIENT_ID, plaintext)

    await expect(
      openRecord(
        kek,
        { wrappedDek: sealed.wrappedDek, entries: [{ sequence: 1, ciphertext: sealed.ciphertext }] },
        OTHER_PATIENT_ID,
      ),
    ).rejects.toThrow()
  })

  it('throws when an entry sealed at one sequence is opened at another', async () => {
    const kek = await makeKek()
    const firstPlaintext = new TextEncoder().encode('entrada de criação')
    const secondPlaintext = new TextEncoder().encode('segunda entrada')
    const sealed = await sealNewPatient(kek, PATIENT_ID, firstPlaintext)
    const secondCiphertext = await sealEntry(sealed.dek, PATIENT_ID, 2, secondPlaintext)

    // Relabeled as sequence 3 on the way in -- the AAD baked into the ciphertext still says 2.
    await expect(
      openRecord(
        kek,
        {
          wrappedDek: sealed.wrappedDek,
          entries: [
            { sequence: 1, ciphertext: sealed.ciphertext },
            { sequence: 3, ciphertext: secondCiphertext },
          ],
        },
        PATIENT_ID,
      ),
      // sequence 3 with only 2 entries is caught by the contiguity check before decryption is
      // even attempted -- see the dedicated contiguity test below for that check in isolation.
    ).rejects.toThrow()
  })

  it('throws on a gap in the sequence run before attempting to decrypt anything', async () => {
    const kek = await makeKek()
    const plaintext = new TextEncoder().encode('entrada de criação')
    const sealed = await sealNewPatient(kek, PATIENT_ID, plaintext)

    await expect(
      openRecord(
        kek,
        {
          wrappedDek: sealed.wrappedDek,
          // Sequence 2 is missing entirely -- a server withholding an entry from the middle
          // of the record must not silently produce a shorter-but-plausible-looking result.
          entries: [
            { sequence: 1, ciphertext: sealed.ciphertext },
            { sequence: 3, ciphertext: sealed.ciphertext },
          ],
        },
        PATIENT_ID,
      ),
    ).rejects.toThrow(/gap or duplicate/)
  })
})
