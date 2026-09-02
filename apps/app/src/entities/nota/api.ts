import { request, type ProblemResult } from '../../shared/api'
import { encodeBase64 } from '../../shared/lib/base64'

export type AssinarNotaResult = { ok: true; noteId: string; revisao: number; signedAt: string } | ProblemResult

export async function assinarNota(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  noteId: string,
  params: { revisao: number; signature: Uint8Array<ArrayBuffer> },
): Promise<AssinarNotaResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/notes/${noteId}/signature`,
    { revisao: params.revisao, signature: encodeBase64(params.signature) },
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { revisao: number; signedAt: string }
  return { ok: true, noteId, revisao: body.revisao, signedAt: body.signedAt }
}
