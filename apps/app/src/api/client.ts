export type HealthDbResult = { ok: true } | { ok: false; code: string; params: Record<string, string> }

// GET /health/db on the .NET API: 200 with an empty body when the database
// is reachable; a non-2xx `application/problem+json` body (RFC 9457) with a
// machine-readable `code` + `params` otherwise. Deliberately minimal — this
// is the only HTTP call in the app so far, no shared client/retry layer to
// fit into.
export async function getHealthDb(baseUrl: string): Promise<HealthDbResult> {
  const response = await fetch(`${baseUrl}/health/db`)

  if (response.ok) {
    return { ok: true }
  }

  const problem = (await response.json()) as { code: string; params: Record<string, string> }
  return { ok: false, code: problem.code, params: problem.params }
}

// Mirrors Api.Accounts.AccountRole (apps/api/src/Api/Accounts/AccountRole.cs) --
// the two account kinds S02-01's segmented control chooses between.
export type AccountRole = 'Professional' | 'Patient'

// Mirrors Api.Accounts.TwoFactorRequirement (apps/api/src/Api/Accounts/TwoFactorRequirement.cs).
// 'NotApplicable' is the pre-existing behavior (always true for Patient accounts); a
// Professional account comes back as 'SetupRequired' (never confirmed a TOTP enrollment) or
// 'ChallengeRequired' (already has one) -- see AuthScreen's wiring of TotpSetup/TotpChallenge.
export type TwoFactorRequirement = 'NotApplicable' | 'SetupRequired' | 'ChallengeRequired'

// Security-review fix (backend): register/login/google now mint an opaque, single-use,
// 10-minute two-factor ticket alongside `twoFactorRequirement` -- `null` when
// `twoFactorRequirement` is 'NotApplicable', a string otherwise. The TOTP begin/confirm/
// challenge endpoints require it back (proof the caller actually passed register/login/
// Google for this exact account) instead of trusting the accountId URL segment alone.
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

// System.Text.Json's default byte[] converter is a base64 string -- this is
// the ONLY place in the app that knows the wire shape of a passwordVerifier;
// callers (password-verifier.ts, AuthScreen) work in raw bytes throughout.
function passwordVerifierToBase64(passwordVerifier: Uint8Array): string {
  let binary = ''
  for (const byte of passwordVerifier) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

// `accessToken`, when passed, is sent as `Authorization: Bearer <token>` -- the device-pairing
// endpoints (S02-04) are the first callers in this file that need it; every pre-existing caller
// omits it and gets the exact same request it always has (no Authorization header).
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

// Mirrors postJson's accessToken convention above, for the pairing endpoints that are GETs
// instead of POSTs. With no token, this is a bare `fetch(url)` -- same shape as getHealthDb.
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

/**
 * POST /auth/register (ADR-S02-02: `passwordVerifier` is a client-derived
 * Argon2id output -- see auth/password-verifier.ts -- never the plaintext
 * password). 201 -> the created account; 400/409 -> Problem+JSON code+params.
 */
export async function register(
  baseUrl: string,
  params: { email: string; passwordVerifier: Uint8Array; role: AccountRole },
): Promise<RegisterResult> {
  const response = await postJson(baseUrl, '/auth/register', {
    email: params.email,
    passwordVerifier: passwordVerifierToBase64(params.passwordVerifier),
    role: params.role,
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

/**
 * POST /auth/login. 200 -> the account; 400/401 -> Problem+JSON code+params
 * (401 is deliberately identical for "unknown e-mail" and "wrong password" --
 * see AccountService.LoginAsync -- this client does not and must not try to
 * tell those two cases apart).
 */
export async function login(
  baseUrl: string,
  params: { email: string; passwordVerifier: Uint8Array },
): Promise<LoginResult> {
  const response = await postJson(baseUrl, '/auth/login', {
    email: params.email,
    passwordVerifier: passwordVerifierToBase64(params.passwordVerifier),
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

/**
 * POST /auth/google. `requestedRole` only takes effect when the Google
 * identity's e-mail has no existing account -- when it does, the response's
 * `role` is the backend-resolved one and this client passes it straight
 * through unchanged (ADR-S02-01: the UI never asks again).
 */
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

/**
 * POST /accounts/{accountId}/totp (S02-03/S02-04: mandatory TOTP enrollment for
 * Professional accounts). Security-review fix: `ticket` is the two-factor ticket from
 * register/login/google for this exact account -- the backend rejects a missing or
 * mismatched ticket with 401 `auth.totp_ticket_invalid` instead of trusting the accountId
 * URL segment alone. 200 -> the Base32 secret and the otpauth:// URI for the user to add
 * manually to an authenticator app (no QR code generation in this repo); 401/404/409 ->
 * Problem+JSON code+params.
 */
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

/**
 * POST /accounts/{accountId}/totp/confirm. `ticket` is the same two-factor ticket passed
 * to beginTotpEnrollment -- see its doc comment. 200 -> the 10 single-use backup codes in
 * clear text -- the only response that ever exposes them (ADR-S02-04), the caller must
 * show them to the user now; 400/401/404/409 -> Problem+JSON code+params.
 */
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

/**
 * POST /accounts/{accountId}/totp/challenge (exactly one of `code`/`backupCode` in the
 * request, plus `ticket` -- see beginTotpEnrollment's doc comment). 200 -> the
 * LoginResponse shape, now genuinely authenticated; 400/401/404/409 -> Problem+JSON
 * code+params.
 */
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

// S02-04 device-pairing-by-QR handshake. Five calls, in the order the handshake actually
// happens: the already-paired primary device opens a session and shows it as a QR code
// (createPairingSession); the new device scans it and claims the session with its own public
// key, no auth yet -- it has no account session (claimPairingSession); the primary device polls
// for the claim (getPairingClaimStatus), then -- once claimed -- encrypts the account's KEK to
// the new device's public key and uploads it (submitPairingPayload); the new device polls for
// and downloads that payload, again with no auth (fetchPairingPayload). Binary fields
// (X25519 public keys, encrypted KEK ciphertext) are plain base64 strings on this side --
// System.Text.Json serializes .NET byte[] that way automatically, same as passwordVerifier
// above, but these are passed straight through as opaque strings instead of raw bytes: the
// crypto (encoding/decoding, actually encrypting the KEK) is wired in a later slice.

/**
 * POST /accounts/{accountId}/devices/pairing-sessions. `accessToken` is the account's bearer
 * access token (Authorization: Bearer). 201 -> a session id (opaque, embedded in the QR code)
 * and its expiry; 401 -> Problem+JSON code+params (e.g. `auth.access_token_invalid`).
 */
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

/**
 * POST /devices/pairing-sessions/{sessionId}/claim. No auth -- the new device has no account
 * session yet, only the sessionId it scanned off the QR code. 200 -> the primary device's
 * public key, so the new device can address the KEK it's about to receive; 404 -> Problem+JSON
 * code+params (`auth.device_pairing_session_not_found`, e.g. expired or already claimed).
 */
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

/**
 * GET /accounts/{accountId}/devices/pairing-sessions/{sessionId}/claim-status. `accessToken` is
 * the primary device's bearer access token. 200 -> whether the new device has claimed the
 * session yet, and its public key once it has (null until then); 401/404 -> Problem+JSON
 * code+params (404 is `auth.device_pairing_session_not_found`).
 */
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

/**
 * POST /accounts/{accountId}/devices/pairing-sessions/{sessionId}/payload. `accessToken` is the
 * primary device's bearer access token; `encryptedKek` is the account's KEK, already encrypted
 * to the new device's public key by the caller (crypto wiring lands in a later slice). 204, no
 * body, on success; 401/404/409 -> Problem+JSON code+params (404
 * `auth.device_pairing_session_not_found`, 409 `auth.device_pairing_payload_not_ready` -- the
 * session hasn't been claimed yet).
 */
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

/**
 * GET /devices/pairing-sessions/{sessionId}/payload. No auth -- same as claimPairingSession,
 * the new device only has the sessionId. 200 -> the encrypted KEK the primary device uploaded;
 * 404 -> Problem+JSON code+params (`auth.device_pairing_payload_not_delivered` -- the primary
 * device hasn't uploaded it yet).
 */
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

/**
 * POST /auth/recover (S02-06: BIP39 recovery-phrase account recovery). `recoveryVerifier` is
 * the client-derived Argon2id output of the recovery phrase -- see
 * auth/recovery-verifier.ts -- never the mnemonic itself, same discipline as `login()`'s
 * passwordVerifier. 200 -> the same LoginResponse shape login() returns (twoFactorTicket set
 * whenever a Professional account still needs its TOTP challenge); 401 -> Problem+JSON
 * `auth.invalid_recovery_phrase` (deliberately generic -- see problem-messages.ts -- for
 * either an unknown e-mail or a wrong recovery phrase); 400 -> `validation.invalid_field`.
 */
export async function recoverAccess(
  baseUrl: string,
  params: { email: string; recoveryVerifier: Uint8Array },
): Promise<LoginResult> {
  const response = await postJson(baseUrl, '/auth/recover', {
    email: params.email,
    recoveryVerifier: passwordVerifierToBase64(params.recoveryVerifier),
  })

  if (!response.ok) {
    return readProblem(response)
  }

  const account = (await response.json()) as AccountResult
  return { ok: true, account }
}

/**
 * POST /accounts/{accountId}/recovery-phrase (S02-06). `accessToken` is the account's bearer
 * access token (Authorization: Bearer, same convention as createPairingSession above);
 * `recoveryVerifier` is the client-derived Argon2id output -- see recoverAccess's doc comment.
 * Only a Professional account can call this. 200, empty-ish body, on success; 401 ->
 * Problem+JSON code+params (`auth.access_token_invalid` for a missing/invalid/mismatched
 * bearer token), 404/409 -> `auth.account_not_found`/`auth.not_a_professional_account`.
 */
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
    { recoveryVerifier: passwordVerifierToBase64(recoveryVerifier) },
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
