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

export interface AccountResult {
  id: string
  email: string
  role: AccountRole
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

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
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
    account: { id: body.id, email: body.email, role: body.role },
    isNewAccount: body.isNewAccount,
  }
}
