import { type CryptoKey, webcrypto } from '@limmiar/crypto'

// Same AAD discipline as patients/patient-crypto.ts and copilot/copilot-crypto.ts: versioned
// prefix + UTF-8 bytes, one distinct AAD per use (DEK wrap vs. embedding ciphertext) so the two
// blobs can never be swapped for each other across accounts or contexts.
const DEK_AAD_PREFIX = 'limmiar/voice-dek/v1|'
const EMBEDDING_AAD_PREFIX = 'limmiar/voice-embedding/v1|'

export function voiceDekAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${DEK_AAD_PREFIX}${accountId}`)
}

export function voiceEmbeddingAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${EMBEDDING_AAD_PREFIX}${accountId}`)
}

// Wire format for the plaintext: Float32Array bytes in platform byte order, elements in input
// order, no length header -- abrirEmbedding (S06-05) must decode it exactly this way.
export async function selarEmbedding(
  kek: CryptoKey,
  accountId: string,
  embedding: readonly number[],
): Promise<{ wrappedDek: Uint8Array<ArrayBuffer>; sealedEmbedding: Uint8Array<ArrayBuffer> }> {
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, voiceDekAad(accountId))
  const plaintext = new Uint8Array(Float32Array.from(embedding).buffer)
  const sealedEmbedding = await webcrypto.encrypt(dek, plaintext, voiceEmbeddingAad(accountId))
  return { wrappedDek: wrapped, sealedEmbedding }
}
