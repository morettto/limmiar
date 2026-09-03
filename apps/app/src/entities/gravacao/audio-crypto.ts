import { type CryptoKey, webcrypto } from '@limmiar/crypto'

// Same discipline as patients/patient-crypto.ts: AAD scoped to sessionId (+ seq per chunk),
// versioned prefix so a future format change never collides with today's ciphertexts.
const AUDIO_CHUNK_AAD_PREFIX = 'limmiar/audio-chunk/v1|'

export function audioChunkAad(sessionId: string, seq: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${AUDIO_CHUNK_AAD_PREFIX}${sessionId}|${seq}`)
}

/** Seals one PCM chunk under the session's DEK. Wire format: iv(12) || ciphertext || tag(16). */
export function sealChunk(
  dek: CryptoKey,
  sessionId: string,
  seq: number,
  chunk: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.encrypt(dek, chunk, audioChunkAad(sessionId, seq))
}

/** Inverso de `sealChunk`. Rejeita se `sessionId`/`seq` não forem os mesmos usados para
 *  selar (AAD errada) -- é o que impede um chunk de outra sessão, ou fora de ordem,
 *  de abrir por bom. */
export function abrirChunk(
  dek: CryptoKey,
  sessionId: string,
  seq: number,
  selado: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.decrypt(dek, selado, audioChunkAad(sessionId, seq))
}
