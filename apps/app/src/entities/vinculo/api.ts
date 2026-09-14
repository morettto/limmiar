import { request, type ProblemResult } from '../../shared/api/client'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'

// wrappedDek/sealedPrivateKey are pinned to Uint8Array<ArrayBuffer> (not plain Uint8Array) because
// they round-trip through webcrypto.ts's unwrapDek/decrypt, which require that exact buffer type
// (same convention as entities/patient/api.ts's wrappedDek/ciphertext).
export interface ParDeChavesSelado {
  publicKey: Uint8Array
  wrappedDek: Uint8Array<ArrayBuffer>
  sealedPrivateKey: Uint8Array<ArrayBuffer>
}

export interface Vinculo {
  profissionalAccountId: string
  pacienteAccountId: string
  patientId: string
  vinculadoEm: string
  chavePublicaDoPar: Uint8Array | null
}

interface ParDeChavesWire {
  publicKey: string
  wrappedDek: string
  sealedPrivateKey: string
}

interface VinculoWire {
  professionalAccountId: string
  patientAccountId: string
  patientId: string
  linkedAt: string
  peerPublicKey: string | null
}

function parDeChavesDeWire(wire: ParDeChavesWire): ParDeChavesSelado {
  return {
    publicKey: decodeBase64(wire.publicKey),
    wrappedDek: decodeBase64(wire.wrappedDek),
    sealedPrivateKey: decodeBase64(wire.sealedPrivateKey),
  }
}

function vinculoDeWire(wire: VinculoWire): Vinculo {
  return {
    profissionalAccountId: wire.professionalAccountId,
    pacienteAccountId: wire.patientAccountId,
    patientId: wire.patientId,
    vinculadoEm: wire.linkedAt,
    chavePublicaDoPar: wire.peerPublicKey === null ? null : decodeBase64(wire.peerPublicKey),
  }
}

export type PublicarParDeChavesResult = { ok: true } | ProblemResult

export async function publicarParDeChaves(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  par: ParDeChavesSelado,
): Promise<PublicarParDeChavesResult> {
  const result = await request(
    baseUrl,
    'PUT',
    `/accounts/${accountId}/key-pair`,
    {
      publicKey: encodeBase64(par.publicKey),
      wrappedDek: encodeBase64(par.wrappedDek),
      sealedPrivateKey: encodeBase64(par.sealedPrivateKey),
    },
    accessToken,
  )
  if (!result.ok) {
    return result
  }
  return { ok: true }
}

export type ObterParDeChavesResult = { ok: true; par: ParDeChavesSelado } | ProblemResult

export async function obterParDeChaves(
  baseUrl: string,
  accountId: string,
  accessToken: string,
): Promise<ObterParDeChavesResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/key-pair`, undefined, accessToken)
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as ParDeChavesWire
  return { ok: true, par: parDeChavesDeWire(body) }
}

export type CriarConviteVinculoResult = { ok: true; codigo: string; expiraEm: string } | ProblemResult

export async function criarConviteVinculo(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
): Promise<CriarConviteVinculoResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/patients/${patientId}/link-invites`,
    undefined,
    accessToken,
  )
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as { code: string; expiresAt: string }
  return { ok: true, codigo: body.code, expiraEm: body.expiresAt }
}

export type ResgatarConviteVinculoResult = { ok: true; vinculo: Vinculo } | ProblemResult

export async function resgatarConviteVinculo(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  codigo: string,
): Promise<ResgatarConviteVinculoResult> {
  const result = await request(baseUrl, 'POST', `/accounts/${accountId}/links`, { code: codigo }, accessToken)
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as VinculoWire
  return { ok: true, vinculo: vinculoDeWire(body) }
}

export type ListarVinculosResult = { ok: true; vinculos: Vinculo[] } | ProblemResult

export async function listarVinculos(
  baseUrl: string,
  accountId: string,
  accessToken: string,
): Promise<ListarVinculosResult> {
  const result = await request(baseUrl, 'GET', `/accounts/${accountId}/links`, undefined, accessToken)
  if (!result.ok) {
    return result
  }
  const body = (await result.response.json()) as VinculoWire[]
  return { ok: true, vinculos: body.map(vinculoDeWire) }
}

export type DesvincularResult = { ok: true } | ProblemResult

export async function desvincular(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  outraContaId: string,
): Promise<DesvincularResult> {
  const result = await request(
    baseUrl,
    'DELETE',
    `/accounts/${accountId}/links/${outraContaId}`,
    undefined,
    accessToken,
  )
  if (!result.ok) {
    return result
  }
  return { ok: true }
}
