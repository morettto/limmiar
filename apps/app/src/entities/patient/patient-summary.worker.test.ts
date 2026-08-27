import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealNewPatient } from './patient-crypto'
import './patient-summary.worker'
import type { SealedSummary } from './patient-summary'

// This file's `self.onmessage` assignment runs as an import side effect (jsdom's `self` is
// `window`), so no real Worker is needed here -- just invoke the handler directly and assert
// what it posts back. The real dedicated-Worker roundtrip is covered by worker-client.test.ts.

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

async function sealSummary(kek: CryptoKey, patientId: string, summary: { name: string; risk: string }): Promise<SealedSummary> {
  const plaintext = new TextEncoder().encode(JSON.stringify(summary))
  const { wrappedDek, ciphertext } = await sealNewPatient(kek, patientId, plaintext)
  return { patientId, wrappedDek, ciphertext }
}

describe('patient-summary.worker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decrypts the posted batch and posts the results back', async () => {
    const kek = await makeKek()
    const items = [await sealSummary(kek, 'p1', { name: 'Ana', risk: 'elevado' })]
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => {})

    await self.onmessage?.({ data: { kek, items } } as MessageEvent)

    expect(postMessage).toHaveBeenCalledWith([{ patientId: 'p1', ok: true, name: 'Ana', risk: 'elevado' }])
  })
})
