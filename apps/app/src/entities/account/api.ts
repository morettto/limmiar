import { encodeBase64 } from '../../shared/lib/base64'
import { request, type ProblemResult } from '../../shared/api/client'
import type { Account, AccountRole } from './account'

export type RegisterResult = { ok: true; account: Account } | ProblemResult
export type LoginResult = { ok: true; account: Account } | ProblemResult
export type GoogleAuthResult = { ok: true; account: Account; isNewAccount: boolean } | ProblemResult

export async function register(
  baseUrl: string,
  params: { email: string; passwordVerifier: Uint8Array; role: AccountRole },
): Promise<RegisterResult> {
  const result = await request(baseUrl, 'POST', '/auth/register', {
    email: params.email,
    passwordVerifier: encodeBase64(params.passwordVerifier),
    role: params.role,
  })
  if (!result.ok) {
    return result
  }

  const account = (await result.response.json()) as Account
  return { ok: true, account }
}

// The backend returns the same error for an unknown email and a wrong password. This
// client must not try to tell them apart.
export async function login(
  baseUrl: string,
  params: { email: string; passwordVerifier: Uint8Array },
): Promise<LoginResult> {
  const result = await request(baseUrl, 'POST', '/auth/login', {
    email: params.email,
    passwordVerifier: encodeBase64(params.passwordVerifier),
  })
  if (!result.ok) {
    return result
  }

  const account = (await result.response.json()) as Account
  return { ok: true, account }
}

export async function continueWithGoogle(
  baseUrl: string,
  params: { idToken: string; requestedRole: AccountRole },
): Promise<GoogleAuthResult> {
  const result = await request(baseUrl, 'POST', '/auth/google', {
    idToken: params.idToken,
    requestedRole: params.requestedRole,
  })
  if (!result.ok) {
    return result
  }

  const { isNewAccount, ...account } = (await result.response.json()) as Account & { isNewAccount: boolean }
  return { ok: true, account, isNewAccount }
}

export type BeginTotpEnrollmentResult = { ok: true; secret: string; provisioningUri: string } | ProblemResult

export async function beginTotpEnrollment(
  baseUrl: string,
  accountId: string,
  ticket: string,
): Promise<BeginTotpEnrollmentResult> {
  const result = await request(baseUrl, 'POST', `/accounts/${accountId}/totp`, { ticket })
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { secret: string; provisioningUri: string }
  return { ok: true, secret: body.secret, provisioningUri: body.provisioningUri }
}

export type ConfirmTotpEnrollmentResult = { ok: true; backupCodes: string[] } | ProblemResult

export async function confirmTotpEnrollment(
  baseUrl: string,
  accountId: string,
  ticket: string,
  code: string,
): Promise<ConfirmTotpEnrollmentResult> {
  const result = await request(baseUrl, 'POST', `/accounts/${accountId}/totp/confirm`, { ticket, code })
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { backupCodes: string[] }
  return { ok: true, backupCodes: body.backupCodes }
}

export type TotpChallengeResult = { ok: true; account: Account } | ProblemResult

export async function verifyTotpChallenge(
  baseUrl: string,
  accountId: string,
  ticket: string,
  params: { code: string } | { backupCode: string },
): Promise<TotpChallengeResult> {
  const result = await request(baseUrl, 'POST', `/accounts/${accountId}/totp/challenge`, { ticket, ...params })
  if (!result.ok) {
    return result
  }

  const account = (await result.response.json()) as Account
  return { ok: true, account }
}

export type MagicLinkCeremonyType = 'Register' | 'Assert'

export type RequestMagicLinkResult = { ok: true } | ProblemResult

export async function requestMagicLink(baseUrl: string, params: { email: string }): Promise<RequestMagicLinkResult> {
  const result = await request(baseUrl, 'POST', '/auth/magic-link/request', { email: params.email })
  if (!result.ok) {
    return result
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
  const result = await request(baseUrl, 'POST', '/auth/magic-link/verify', { token: params.token })
  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as {
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
  const result = await request(baseUrl, 'POST', '/auth/recover', {
    email: params.email,
    recoveryVerifier: encodeBase64(params.recoveryVerifier),
  })
  if (!result.ok) {
    return result
  }

  const account = (await result.response.json()) as Account
  return { ok: true, account }
}

export type RegisterRecoveryPhraseResult = { ok: true } | ProblemResult

export async function registerRecoveryPhrase(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  recoveryVerifier: Uint8Array,
): Promise<RegisterRecoveryPhraseResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/recovery-phrase`,
    { recoveryVerifier: encodeBase64(recoveryVerifier) },
    accessToken,
  )
  if (!result.ok) {
    return result
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
  const result = await request(baseUrl, 'POST', '/auth/magic-link/webauthn/complete', {
    magicLinkTicket: params.magicLinkTicket,
    credentialId: params.credentialId,
    clientDataJson: params.clientDataJson,
    attestationObject: params.attestationObject,
    authenticatorData: params.authenticatorData,
    signature: params.signature,
  })
  if (!result.ok) {
    return result
  }

  const account = (await result.response.json()) as MagicLinkAccount
  return { ok: true, account }
}
