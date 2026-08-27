import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { sealNewPatient } from './patient-crypto'
import { decryptSummaries } from './decrypt-summaries'
import type { SealedSummary } from './patient-summary'

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

async function sealSummary(
  kek: CryptoKey,
  patientId: string,
  summary: { name: string; risk: string },
): Promise<SealedSummary> {
  const plaintext = new TextEncoder().encode(JSON.stringify(summary))
  const { wrappedDek, ciphertext } = await sealNewPatient(kek, patientId, plaintext)
  return { patientId, wrappedDek, ciphertext }
}

describe('decryptSummaries', () => {
  it('returns [] for an empty batch', async () => {
    const kek = await makeKek()
    await expect(decryptSummaries(kek, [])).resolves.toEqual([])
  })

  it('decrypts every item in a batch, same order, same length', async () => {
    const kek = await makeKek()
    const items = await Promise.all([
      sealSummary(kek, 'p1', { name: 'Ana', risk: 'elevado' }),
      sealSummary(kek, 'p2', { name: 'Bruno', risk: 'baixo' }),
    ])

    const results = await decryptSummaries(kek, items)

    expect(results).toEqual([
      { patientId: 'p1', ok: true, name: 'Ana', risk: 'elevado' },
      { patientId: 'p2', ok: true, name: 'Bruno', risk: 'baixo' },
    ])
  })

  it('a wrong KEK for one item does not derail the rest of the batch', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    const good = await sealSummary(kek, 'p-good', { name: 'Ana', risk: 'elevado' })
    const bad = await sealSummary(wrongKek, 'p-bad', { name: 'Bruno', risk: 'baixo' })

    const results = await decryptSummaries(kek, [good, bad])

    expect(results).toEqual([
      { patientId: 'p-good', ok: true, name: 'Ana', risk: 'elevado' },
      { patientId: 'p-bad', ok: false },
    ])
  })

  it('corrupted/invalid plaintext for one item yields ok:false for that item only, no error detail leaked', async () => {
    const kek = await makeKek()
    const good = await sealSummary(kek, 'p-good', { name: 'Ana', risk: 'elevado' })
    const garbagePlaintext = new TextEncoder().encode('{not valid json')
    const { wrappedDek, ciphertext } = await sealNewPatient(kek, 'p-garbage', garbagePlaintext)

    const results = await decryptSummaries(kek, [good, { patientId: 'p-garbage', wrappedDek, ciphertext }])

    expect(results).toEqual([
      { patientId: 'p-good', ok: true, name: 'Ana', risk: 'elevado' },
      { patientId: 'p-garbage', ok: false },
    ])
  })
})
