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

// ponytail: teto -- `noteId`/`revisao`/`signedAt` sem consumidor (só `r.ok` é lido); upgrade: ecrã de "assinada em" os usa, ou o tipo encolhe para `{ ok: true }`.
export type ObterAssinaturaResult = { ok: true; noteId: string; revisao: number; signedAt: string } | ProblemResult

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

  // O blob `signature` do body é descartado de propósito: decodificá-lo só serviria a uma
  // verificação client-side que nenhum critério pede e nenhum chamador faz.
  const body = (await result.response.json()) as { revisao: number; signature: string; signedAt: string }
  return { ok: true, noteId, revisao: body.revisao, signedAt: body.signedAt }
}
