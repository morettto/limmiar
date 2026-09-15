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

export interface PartilhaRecebida {
  pacienteAccountId: string
  patientId: string
  vinculadoEm: string
  desvinculadoEm: string | null
  chavePublicaDoPar: Uint8Array<ArrayBuffer> | null
  itens: { partilhadoEm: string; ciphertext: Uint8Array<ArrayBuffer> }[]
}

interface ReceivedShareWire {
  patientAccountId: string
  patientId: string
  linkedAt: string
  unlinkedAt: string | null
  peerPublicKey: string | null
  items: SharedItemWire[]
}

function partilhaRecebidaDeWire(wire: ReceivedShareWire): PartilhaRecebida {
  return {
    pacienteAccountId: wire.patientAccountId,
    patientId: wire.patientId,
    vinculadoEm: wire.linkedAt,
    desvinculadoEm: wire.unlinkedAt,
    chavePublicaDoPar: wire.peerPublicKey === null ? null : decodeBase64(wire.peerPublicKey),
    itens: wire.items.map((item) => ({ partilhadoEm: item.sharedAt, ciphertext: decodeBase64(item.ciphertext) })),
  }
}

export type ListarPartilhasRecebidasResult = { ok: true; partilhas: PartilhaRecebida[] } | ProblemResult

// Substitui listarItensPartilhados (removida na fatia 11, S11-03): 1+N chamadas viram 1. A rota
// GET .../links/{peer}/shared-items continua na API (ver Features/PatientLinks/README.md).
export async function listarPartilhasRecebidas(
  baseUrl: string,
  accountId: string,
  accessToken: string,
): Promise<ListarPartilhasRecebidasResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/received-shares`, undefined, accessToken)
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as ReceivedShareWire[]
  return { ok: true, partilhas: body.map(partilhaRecebidaDeWire) }
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
