import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { request, type ProblemResult } from '../../shared/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { voiceDekAad, voiceEmbeddingAad } from './voice-crypto'

type VoiceEnrollmentResult = { ok: true } | ProblemResult

function voiceEnrollmentPath(accountId: string): string {
  return `/accounts/${accountId}/voice-enrollment`
}

// wrappedDek/sealedEmbedding are opaque bytes end to end, same convention as
// createPatient's wrappedDek/ciphertext -- the raw embedding is never a request property of
// its own.
export async function cadastrarVoz(
  baseUrl: string,
  accountId: string,
  token: string,
  kek: CryptoKey,
  embedding: readonly number[],
): Promise<VoiceEnrollmentResult> {
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, voiceDekAad(accountId))
  const plaintext = new Uint8Array(Float32Array.from(embedding).buffer)
  const sealedEmbedding = await webcrypto.encrypt(dek, plaintext, voiceEmbeddingAad(accountId))

  const result = await request(
    baseUrl,
    'PUT',
    voiceEnrollmentPath(accountId),
    { wrappedDek: encodeBase64(wrapped), sealedEmbedding: encodeBase64(sealedEmbedding) },
    token,
  )

  if (!result.ok) {
    return result
  }
  return { ok: true }
}

export type ObterCadastroVozResult =
  | { ok: true; wrappedDek: Uint8Array<ArrayBuffer>; sealedEmbedding: Uint8Array<ArrayBuffer> }
  | ProblemResult

export async function obterCadastroVoz(
  baseUrl: string,
  accountId: string,
  token: string,
): Promise<ObterCadastroVozResult> {
  const result = await request(baseUrl, 'GET', voiceEnrollmentPath(accountId), undefined, token)

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { wrappedDek: string; sealedEmbedding: string }
  return {
    ok: true,
    wrappedDek: decodeBase64(body.wrappedDek),
    sealedEmbedding: decodeBase64(body.sealedEmbedding),
  }
}

export async function removerCadastroVoz(
  baseUrl: string,
  accountId: string,
  token: string,
): Promise<VoiceEnrollmentResult> {
  const result = await request(baseUrl, 'DELETE', voiceEnrollmentPath(accountId), undefined, token)

  if (!result.ok) {
    return result
  }
  return { ok: true }
}
