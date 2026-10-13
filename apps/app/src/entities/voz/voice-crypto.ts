import { t } from '@lingui/core/macro'
import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { DIMENSOES_VOZ, embeddingValido, MODELO_VOZ } from './modelo'

const DEK_AAD_PREFIX = `limmiar/voice-dek/titanet-large/v1|${MODELO_VOZ}|`
const EMBEDDING_AAD_PREFIX = `limmiar/voice-embedding/titanet-large/v1|${MODELO_VOZ}|`

export function voiceDekAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${DEK_AAD_PREFIX}${accountId}`)
}

export function voiceEmbeddingAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${EMBEDDING_AAD_PREFIX}${accountId}`)
}

export async function selarEmbedding(
  kek: CryptoKey,
  accountId: string,
  embedding: readonly number[],
): Promise<{ wrappedDek: Uint8Array<ArrayBuffer>; sealedEmbedding: Uint8Array<ArrayBuffer> }> {
  if (!embeddingValido(embedding)) throw new Error(t`Perfil de voz inválido.`)
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, voiceDekAad(accountId))
  const plaintext = new Uint8Array(DIMENSOES_VOZ * 4)
  const view = new DataView(plaintext.buffer)
  embedding.forEach((valor, indice) => view.setFloat32(indice * 4, valor, true))
  try {
    const sealedEmbedding = await webcrypto.encrypt(dek, plaintext, voiceEmbeddingAad(accountId))
    return { wrappedDek: wrapped, sealedEmbedding }
  } finally { plaintext.fill(0) }
}

export async function abrirEmbedding(kek: CryptoKey, accountId: string,
  wrappedDek: Uint8Array<ArrayBuffer>, sealedEmbedding: Uint8Array<ArrayBuffer>): Promise<number[]> {
  const dek = await webcrypto.unwrapDek(kek, wrappedDek, voiceDekAad(accountId))
  const plaintext = await webcrypto.decrypt(dek, sealedEmbedding, voiceEmbeddingAad(accountId))
  try {
    if (plaintext.length !== DIMENSOES_VOZ * 4) throw new Error(t`Perfil de voz inválido.`)
    const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
    const embedding = Array.from({ length: DIMENSOES_VOZ }, (_, indice) => view.getFloat32(indice * 4, true))
    if (!embeddingValido(embedding)) throw new Error(t`Perfil de voz inválido.`)
    return embedding
  } finally { plaintext.fill(0) }
}
