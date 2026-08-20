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
