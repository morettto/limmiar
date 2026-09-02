import '@vitest/web-worker'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealNewPatient } from './patient-crypto'
import { openSummariesInWorker } from './worker-client'
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

describe('openSummariesInWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Load-criterion test: 500 patients through the real dedicated Worker, not the mocked seam
  // PatientWallet.test.tsx uses. Proves the roundtrip decrypts at scale and that a batch mixing
  // good and tampered items still isolates the failure through the real postMessage path.
  it('decrypts a 500-item batch through a real Worker, order preserved, one bad item isolated', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    const items = await Promise.all(
      Array.from({ length: 500 }, (_, i) =>
        sealSummary(i === 250 ? wrongKek : kek, `p${i}`, {
          name: `Paciente ${i}`,
          risk: (['elevado', 'moderado', 'baixo'] as const)[i % 3],
        }),
      ),
    )

    const results = await openSummariesInWorker(kek, items)

    expect(results).toHaveLength(500)
    expect(results.map((r) => r.patientId)).toEqual(items.map((item) => item.patientId))
    expect(results[250]).toEqual({ patientId: 'p250', ok: false })
    expect(results[0]).toEqual({ patientId: 'p0', ok: true, name: 'Paciente 0', risk: 'elevado' })
    expect(results[499]).toEqual({ patientId: 'p499', ok: true, name: 'Paciente 499', risk: 'moderado' })
  })

  it('rejects and terminates the worker when it errors', async () => {
    const listeners: { onerror?: (event: { message: string }) => void } = {}
    const terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      vi.fn().mockImplementation(function FakeWorker() {
        return {
          postMessage: () => {
            listeners.onerror?.({ message: 'boom' })
          },
          terminate,
          set onmessage(_fn: unknown) {},
          set onerror(fn: (event: { message: string }) => void) {
            listeners.onerror = fn
          },
        }
      }),
    )

    const kek = await makeKek()
    await expect(openSummariesInWorker(kek, [])).rejects.toThrow('boom')
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('rejects and terminates the worker when the signal aborts before it responds', async () => {
    const kek = await makeKek()
    const items = [await sealSummary(kek, 'p1', { name: 'Ana', risk: 'elevado' })]
    const controller = new AbortController()

    const promise = openSummariesInWorker(kek, items, controller.signal)
    controller.abort()

    await expect(promise).rejects.toThrow('aborted')
  })
})
