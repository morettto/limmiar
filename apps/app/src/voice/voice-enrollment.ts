import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { deleteRequest, getJson, putJson, readProblem, type ProblemResult } from '../api/client'
import { decodeBase64, encodeBase64 } from '../devices/base64'
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

  const response = await putJson(
    baseUrl,
    voiceEnrollmentPath(accountId),
    { wrappedDek: encodeBase64(wrapped), sealedEmbedding: encodeBase64(sealedEmbedding) },
    token,
  )

  if (!response.ok) {
    return readProblem(response)
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
  const response = await getJson(baseUrl, voiceEnrollmentPath(accountId), token)

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { wrappedDek: string; sealedEmbedding: string }
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
  const response = await deleteRequest(baseUrl, voiceEnrollmentPath(accountId), token)

  if (!response.ok) {
    return readProblem(response)
  }
  return { ok: true }
}
