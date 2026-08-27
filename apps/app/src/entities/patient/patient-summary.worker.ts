import type { CryptoKey } from '@limmiar/crypto'
import { decryptSummaries } from './decrypt-summaries'
import type { SealedSummary } from './patient-summary'

// Thin plumbing only -- all real logic lives in decryptSummaries (tested without a
// Worker). `self` here types against lib.dom's Window (this project's tsconfig has no
// separate "webworker" lib -- adding one would conflict with the DOM lib the rest of the
// app needs), but Window's postMessage/onmessage signatures are compatible with a
// dedicated worker's at the call sites used below, so no cast is needed.
self.onmessage = async (event: MessageEvent<{ kek: CryptoKey; items: SealedSummary[] }>) => {
  self.postMessage(await decryptSummaries(event.data.kek, event.data.items))
}
