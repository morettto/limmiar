import { request, type ProblemResult } from '../../shared/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'

export type AssinarNotaResult = { ok: true; noteId: string; revision: number; signedAt: string } | ProblemResult

export async function assinarNota(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  noteId: string,
  params: { revision: number; signature: Uint8Array<ArrayBuffer> },
): Promise<AssinarNotaResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/notes/${noteId}/signature`,
    { revision: params.revision, signature: encodeBase64(params.signature) },
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { revision: number; signedAt: string }
  return { ok: true, noteId, revision: body.revision, signedAt: body.signedAt }
}

export type ObterAssinaturaResult = { ok: true; noteId: string; revision: number; signedAt: string; signature: Uint8Array<ArrayBuffer> } | ProblemResult

export async function obterAssinatura(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  noteId: string,
): Promise<ObterAssinaturaResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/notes/${noteId}/signature`, undefined, accessToken)

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { revision: number; signature: string; signedAt: string }
  return { ok: true, noteId, revision: body.revision, signedAt: body.signedAt, signature: decodeBase64(body.signature) }
}
