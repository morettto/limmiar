import { request, type ProblemResult } from '../../shared/api/client'

export type CreatePairingSessionResult = { ok: true; sessionId: string; expiresAt: string } | ProblemResult

export async function createPairingSession(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  primaryPublicKey: string,
): Promise<CreatePairingSessionResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/devices/pairing-sessions`,
    { primaryPublicKey },
    accessToken,
  )
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { sessionId: string; expiresAt: string }
  return { ok: true, sessionId: body.sessionId, expiresAt: body.expiresAt }
}

export type ClaimPairingSessionResult = { ok: true; primaryPublicKey: string } | ProblemResult

export async function claimPairingSession(
  baseUrl: string,
  sessionId: string,
  newDevicePublicKey: string,
): Promise<ClaimPairingSessionResult> {
  const result = await request(baseUrl, 'POST', `/devices/pairing-sessions/${sessionId}/claim`, {
    newDevicePublicKey,
  })
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { primaryPublicKey: string }
  return { ok: true, primaryPublicKey: body.primaryPublicKey }
}

export type PairingClaimStatusResult =
  | { ok: true; claimed: boolean; newDevicePublicKey: string | null }
  | ProblemResult

export async function getPairingClaimStatus(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  sessionId: string,
): Promise<PairingClaimStatusResult> {
  const result = await request(
    baseUrl,
    'GET',
    `/accounts/${accountId}/devices/pairing-sessions/${sessionId}/claim-status`,
    undefined,
    accessToken,
  )
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { claimed: boolean; newDevicePublicKey: string | null }
  return { ok: true, claimed: body.claimed, newDevicePublicKey: body.newDevicePublicKey }
}

export type SubmitPairingPayloadResult = { ok: true } | ProblemResult

export async function submitPairingPayload(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  sessionId: string,
  encryptedKek: string,
): Promise<SubmitPairingPayloadResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/devices/pairing-sessions/${sessionId}/payload`,
    { encryptedKek },
    accessToken,
  )
  if (!result.ok) {
    return result
  }

  return { ok: true }
}

export type FetchPairingPayloadResult = { ok: true; encryptedKek: string } | ProblemResult

export async function fetchPairingPayload(baseUrl: string, sessionId: string): Promise<FetchPairingPayloadResult> {
  const result = await request(baseUrl, 'GET', `/devices/pairing-sessions/${sessionId}/payload`)
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { encryptedKek: string }
  return { ok: true, encryptedKek: body.encryptedKek }
}
