import type { CryptoKey } from '@limmiar/crypto'
import { decryptSummaries } from './decrypt-summaries'
import type { SealedSummary } from './patient-summary'

// Thin plumbing only — the real logic lives in decryptSummaries, tested without a Worker. `self`
// types against lib.dom's Window (no separate "webworker" lib, which would clash with the DOM lib
// the app needs), whose postMessage/onmessage signatures fit the call sites below.
self.onmessage = async (event: MessageEvent<{ kek: CryptoKey; items: SealedSummary[] }>) => {
  self.postMessage(await decryptSummaries(event.data.kek, event.data.items))
}
