import { decodeBase64, encodeBase64 } from '../devices/base64'

export type HealthDbResult = { ok: true } | { ok: false; code: string; params: Record<string, string> }

export async function getHealthDb(baseUrl: string): Promise<HealthDbResult> {
  const response = await fetch(`${baseUrl}/health/db`)

  if (response.ok) {
    return { ok: true }
  }

  const problem = (await response.json()) as { code: string; params: Record<string, string> }
  return { ok: false, code: problem.code, params: problem.params }
}

export type AccountRole = 'Professional' | 'Patient'

export type TwoFactorRequirement = 'NotApplicable' | 'SetupRequired' | 'ChallengeRequired'

// twoFactorTicket proves the caller already passed register, login, or google for this
// account. The TOTP begin/confirm/challenge endpoints require it; they do not trust the
// accountId URL segment alone.
export interface AccountResult {
  id: string
  email: string
  role: AccountRole
  twoFactorRequirement: TwoFactorRequirement
  twoFactorTicket: string | null
}

type ProblemResult = { ok: false; code: string; params: Record<string, string> }

export type RegisterResult = { ok: true; account: AccountResult } | ProblemResult
export type LoginResult = { ok: true; account: AccountResult } | ProblemResult
export type GoogleAuthResult = { ok: true; account: AccountResult; isNewAccount: boolean } | ProblemResult

async function postJson(baseUrl: string, path: string, body: unknown, accessToken?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken !== undefined) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function getJson(baseUrl: string, path: string, accessToken?: string): Promise<Response> {
  if (accessToken === undefined) {
    return fetch(`${baseUrl}${path}`)
  }
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } })
}

async function readProblem(response: Response): Promise<ProblemResult> {
  const problem = (await response.json()) as { code: string; params: Record<string, string> }
  return { ok: false, code: problem.code, params: problem.params }
}

export async function register(
  baseUrl: string,
  params: { email: string; passwordVerifier: Uint8Array; role: AccountRole },
): Promise<RegisterResult> {
  const response = await postJson(baseUrl, '/auth/register', {
    email: params.email,
    passwordVerifier: encodeBase64(params.passwordVerifier),
    role: params.role,
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

// The backend returns the same error for an unknown email and a wrong password. This
// client must not try to tell them apart.
export async function login(
  baseUrl: string,
  params: { email: string; passwordVerifier: Uint8Array },
): Promise<LoginResult> {
  const response = await postJson(baseUrl, '/auth/login', {
    email: params.email,
    passwordVerifier: encodeBase64(params.passwordVerifier),
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

export async function continueWithGoogle(
  baseUrl: string,
  params: { idToken: string; requestedRole: AccountRole },
): Promise<GoogleAuthResult> {
  const response = await postJson(baseUrl, '/auth/google', {
    idToken: params.idToken,
    requestedRole: params.requestedRole,
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as AccountResult & { isNewAccount: boolean }
  return {
    ok: true,
    account: {
      id: body.id,
      email: body.email,
      role: body.role,
      twoFactorRequirement: body.twoFactorRequirement,
      twoFactorTicket: body.twoFactorTicket,
    },
    isNewAccount: body.isNewAccount,
  }
}

export type BeginTotpEnrollmentResult = { ok: true; secret: string; provisioningUri: string } | ProblemResult

export async function beginTotpEnrollment(
  baseUrl: string,
  accountId: string,
  ticket: string,
): Promise<BeginTotpEnrollmentResult> {
  const response = await postJson(baseUrl, `/accounts/${accountId}/totp`, { ticket })

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { secret: string; provisioningUri: string }
  return { ok: true, secret: body.secret, provisioningUri: body.provisioningUri }
}

export type ConfirmTotpEnrollmentResult = { ok: true; backupCodes: string[] } | ProblemResult

export async function confirmTotpEnrollment(
  baseUrl: string,
  accountId: string,
  ticket: string,
  code: string,
): Promise<ConfirmTotpEnrollmentResult> {
  const response = await postJson(baseUrl, `/accounts/${accountId}/totp/confirm`, { ticket, code })

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { backupCodes: string[] }
  return { ok: true, backupCodes: body.backupCodes }
}

export type TotpChallengeResult = { ok: true; account: AccountResult } | ProblemResult

export async function verifyTotpChallenge(
  baseUrl: string,
  accountId: string,
  ticket: string,
  params: { code: string } | { backupCode: string },
): Promise<TotpChallengeResult> {
  const response = await postJson(baseUrl, `/accounts/${accountId}/totp/challenge`, { ticket, ...params })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

export type CreatePairingSessionResult = { ok: true; sessionId: string; expiresAt: string } | ProblemResult

export async function createPairingSession(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  primaryPublicKey: string,
): Promise<CreatePairingSessionResult> {
  const response = await postJson(
    baseUrl,
    `/accounts/${accountId}/devices/pairing-sessions`,
    { primaryPublicKey },
    accessToken,
  )

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { sessionId: string; expiresAt: string }
  return { ok: true, sessionId: body.sessionId, expiresAt: body.expiresAt }
}

export type ClaimPairingSessionResult = { ok: true; primaryPublicKey: string } | ProblemResult

export async function claimPairingSession(
  baseUrl: string,
  sessionId: string,
  newDevicePublicKey: string,
): Promise<ClaimPairingSessionResult> {
  const response = await postJson(baseUrl, `/devices/pairing-sessions/${sessionId}/claim`, { newDevicePublicKey })

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { primaryPublicKey: string }
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
  const response = await getJson(
    baseUrl,
    `/accounts/${accountId}/devices/pairing-sessions/${sessionId}/claim-status`,
    accessToken,
  )

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { claimed: boolean; newDevicePublicKey: string | null }
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
  const response = await postJson(
    baseUrl,
    `/accounts/${accountId}/devices/pairing-sessions/${sessionId}/payload`,
    { encryptedKek },
    accessToken,
  )

  if (!response.ok) {
    return readProblem(response)
  }

  return { ok: true }
}

export type FetchPairingPayloadResult = { ok: true; encryptedKek: string } | ProblemResult

export async function fetchPairingPayload(baseUrl: string, sessionId: string): Promise<FetchPairingPayloadResult> {
  const response = await getJson(baseUrl, `/devices/pairing-sessions/${sessionId}/payload`)

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { encryptedKek: string }
  return { ok: true, encryptedKek: body.encryptedKek }
}

export type MagicLinkCeremonyType = 'Register' | 'Assert'

export type RequestMagicLinkResult = { ok: true } | ProblemResult

export async function requestMagicLink(baseUrl: string, params: { email: string }): Promise<RequestMagicLinkResult> {
  const response = await postJson(baseUrl, '/auth/magic-link/request', { email: params.email })

  if (!response.ok) {
    return readProblem(response)
  }

  return { ok: true }
}

export type VerifyMagicLinkResult =
  | {
      ok: true
      magicLinkTicket: string
      ceremonyType: MagicLinkCeremonyType
      challenge: string
      relyingPartyId: string
      credentialId: string | null
    }
  | ProblemResult

export async function verifyMagicLink(baseUrl: string, params: { token: string }): Promise<VerifyMagicLinkResult> {
  const response = await postJson(baseUrl, '/auth/magic-link/verify', { token: params.token })

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as {
    magicLinkTicket: string
    ceremonyType: MagicLinkCeremonyType
    challenge: string
    relyingPartyId: string
    credentialId: string | null
  }
  return {
    ok: true,
    magicLinkTicket: body.magicLinkTicket,
    ceremonyType: body.ceremonyType,
    challenge: body.challenge,
    relyingPartyId: body.relyingPartyId,
    credentialId: body.credentialId,
  }
}

// auth.invalid_recovery_phrase covers both an unknown email and a wrong recovery phrase.
// This client must not try to tell them apart.
export async function recoverAccess(
  baseUrl: string,
  params: { email: string; recoveryVerifier: Uint8Array },
): Promise<LoginResult> {
  const response = await postJson(baseUrl, '/auth/recover', {
    email: params.email,
    recoveryVerifier: encodeBase64(params.recoveryVerifier),
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

export type CreatePatientResult = { ok: true; patientId: string; createdAt: string } | ProblemResult

// wrappedDek/ciphertext are opaque bytes end to end -- no clinical field is ever a request/response property of its own, everything clinical lives inside ciphertext.
export async function createPatient(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  params: { patientId: string; wrappedDek: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> },
): Promise<CreatePatientResult> {
  const response = await postJson(
    baseUrl,
    `/accounts/${accountId}/patients`,
    {
      patientId: params.patientId,
      wrappedDek: encodeBase64(params.wrappedDek),
      ciphertext: encodeBase64(params.ciphertext),
    },
    accessToken,
  )

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { patientId: string; createdAt: string }
  return { ok: true, patientId: body.patientId, createdAt: body.createdAt }
}

export type AppendPatientEntryResult =
  | { ok: true; entryId: string; sequence: number; createdAt: string }
  | ProblemResult

export async function appendPatientEntry(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
  params: { sequence: number; ciphertext: Uint8Array<ArrayBuffer> },
): Promise<AppendPatientEntryResult> {
  const response = await postJson(
    baseUrl,
    `/accounts/${accountId}/patients/${patientId}/entries`,
    { sequence: params.sequence, ciphertext: encodeBase64(params.ciphertext) },
    accessToken,
  )

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as { entryId: string; sequence: number; createdAt: string }
  return { ok: true, entryId: body.entryId, sequence: body.sequence, createdAt: body.createdAt }
}

export interface PatientRecordEntryResult {
  entryId: string
  sequence: number
  ciphertext: Uint8Array<ArrayBuffer>
  createdAt: string
}

export type GetPatientRecordResult =
  | {
      ok: true
      patientId: string
      wrappedDek: Uint8Array<ArrayBuffer>
      createdAt: string
      lastEntryAt: string
      entries: PatientRecordEntryResult[]
    }
  | ProblemResult

export async function getPatientRecord(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
): Promise<GetPatientRecordResult> {
  const response = await getJson(baseUrl, `/accounts/${accountId}/patients/${patientId}`, accessToken)

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as {
    patientId: string
    wrappedDek: string
    createdAt: string
    lastEntryAt: string
    entries: { entryId: string; sequence: number; ciphertext: string; createdAt: string }[]
  }
  return {
    ok: true,
    patientId: body.patientId,
    wrappedDek: decodeBase64(body.wrappedDek),
    createdAt: body.createdAt,
    lastEntryAt: body.lastEntryAt,
    entries: body.entries.map((entry) => ({
      entryId: entry.entryId,
      sequence: entry.sequence,
      ciphertext: decodeBase64(entry.ciphertext),
      createdAt: entry.createdAt,
    })),
  }
}

export type RegisterRecoveryPhraseResult = { ok: true } | ProblemResult

export async function registerRecoveryPhrase(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  recoveryVerifier: Uint8Array,
): Promise<RegisterRecoveryPhraseResult> {
  const response = await postJson(
    baseUrl,
    `/accounts/${accountId}/recovery-phrase`,
    { recoveryVerifier: encodeBase64(recoveryVerifier) },
    accessToken,
  )

  if (!response.ok) {
    return readProblem(response)
  }

  return { ok: true }
}

export interface MagicLinkAccount {
  id: string
  email: string
  role: AccountRole
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
}

export type CompleteWebAuthnCeremonyResult = { ok: true; account: MagicLinkAccount } | ProblemResult

export async function completeWebAuthnCeremony(
  baseUrl: string,
  params: {
    magicLinkTicket: string
    credentialId: string
    clientDataJson: string
    attestationObject?: string
    authenticatorData?: string
    signature?: string
  },
): Promise<CompleteWebAuthnCeremonyResult> {
  const response = await postJson(baseUrl, '/auth/magic-link/webauthn/complete', {
    magicLinkTicket: params.magicLinkTicket,
    credentialId: params.credentialId,
    clientDataJson: params.clientDataJson,
    attestationObject: params.attestationObject,
    authenticatorData: params.authenticatorData,
    signature: params.signature,
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const body = (await response.json()) as {
    id: string
    email: string
    role: AccountRole
    accessToken: string
    refreshToken: string
    accessTokenExpiresAt: string
  }
  return {
    ok: true,
    account: {
      id: body.id,
      email: body.email,
      role: body.role,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      accessTokenExpiresAt: body.accessTokenExpiresAt,
    },
  }
}
