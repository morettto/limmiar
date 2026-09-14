import { request, type ProblemResult } from '../../shared/api/client'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'

export async function enviarItemPartilhado(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  profissionalAccountId: string,
  ciphertext: Uint8Array,
): Promise<{ ok: true } | ProblemResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/links/${profissionalAccountId}/shared-items`,
    { ciphertext: encodeBase64(ciphertext) },
    accessToken,
  )
  if (!result.ok) {
    return result
  }
  return { ok: true }
}

interface SharedItemWire {
  sharedAt: string
  ciphertext: string
}

export type ListarItensPartilhadosResult =
  | { ok: true; itens: { partilhadoEm: string; ciphertext: Uint8Array<ArrayBuffer> }[] }
  | ProblemResult

export async function listarItensPartilhados(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  pacienteAccountId: string,
): Promise<ListarItensPartilhadosResult> {
  const result = await request(
    baseUrl,
    'GET',
    `/accounts/${accountId}/links/${pacienteAccountId}/shared-items`,
    undefined,
    accessToken,
  )
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as SharedItemWire[]
  return {
    ok: true,
    itens: body.map((item) => ({ partilhadoEm: item.sharedAt, ciphertext: decodeBase64(item.ciphertext) })),
  }
}

interface SharingPreferencesWire {
  version: number
  wrappedDek: string
  ciphertext: string
}

export type ObterPreferenciasPartilhaResult =
  | { ok: true; versao: number; wrappedDek: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }
  | ProblemResult

export async function obterPreferenciasPartilha(
  baseUrl: string,
  accountId: string,
  accessToken: string,
): Promise<ObterPreferenciasPartilhaResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/sharing-preferences`, undefined, accessToken)
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as SharingPreferencesWire
  return {
    ok: true,
    versao: body.version,
    wrappedDek: decodeBase64(body.wrappedDek),
    ciphertext: decodeBase64(body.ciphertext),
  }
}

export type GravarPreferenciasPartilhaResult = { ok: true; versao: number } | ProblemResult

export async function gravarPreferenciasPartilha(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  b: { versaoEsperada: number; wrappedDek: Uint8Array; ciphertext: Uint8Array },
): Promise<GravarPreferenciasPartilhaResult> {
  const result = await request(
    baseUrl,
    'PUT',
    `/accounts/${accountId}/sharing-preferences`,
    {
      expectedVersion: b.versaoEsperada,
      wrappedDek: encodeBase64(b.wrappedDek),
      ciphertext: encodeBase64(b.ciphertext),
    },
    accessToken,
  )
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as { version: number }
  return { ok: true, versao: body.version }
}
