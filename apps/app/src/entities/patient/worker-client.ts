import type { CryptoKey } from '@limmiar/crypto'
import type { SealedSummary, SummaryResult } from './patient-summary'

// ponytail: one round-trip, no comlink/chunking/transferable objects -- a 500-item batch
// of small JSON summaries is a few hundred KB at most, not enough to justify structured-
// clone-avoidance machinery. Revisit only if profiling shows the postMessage clone itself
// (not the decrypt work) is the bottleneck.
export function openSummariesInWorker(
  kek: CryptoKey,
  items: SealedSummary[],
  signal?: AbortSignal,
): Promise<SummaryResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./patient-summary.worker.ts', import.meta.url), { type: 'module' })

    function onAbort() {
      worker.terminate()
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort)

    function cleanup() {
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
    }

    worker.onmessage = (event: MessageEvent<SummaryResult[]>) => {
      cleanup()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message))
    }

    worker.postMessage({ kek, items })
  })
}
