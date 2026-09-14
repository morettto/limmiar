import { expect, type APIRequestContext } from '@playwright/test'
import { API_BASE_URL } from '../../playwright.config'
import { computeTotpCode } from './totp'

// S11-04: setup helpers shared by vinculo-chave-publica.spec.ts -- registering and, for
// professionals, getting to an Active verification status is fixture work (Specs/S11 Partilha
// e espelho P6.md § Cenário E2E, "Preparação"), not a step of the scenario itself.

// Matches playwright.config.ts's StaffAccess__ApiKey for the dotnet webServer -- the only value
// that satisfies IStaffAccessGuard for the staff-only professional-verification decision route.
const STAFF_API_KEY = 'e2e-unused-staff-key'

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** A distinct, non-zero 32-byte test KEK per persona/device -- never all-zero, same rationale as device-pairing.spec.ts's TEST_KEK, so a bug that zero-fills a buffer cannot silently pass. */
export function contaTestKek(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seed) % 256)
}

export interface ContaPaciente {
  accountId: string
  accessToken: string
  email: string
}

export interface ContaProfissional {
  accountId: string
  accessToken: string
  email: string
}

/** POST /auth/register (Patient role) -- a Patient account never needs TOTP enrollment (ADR-S02-03/S02-04), so registration alone returns a real session. */
export async function registrarPaciente(request: APIRequestContext, label: string): Promise<ContaPaciente> {
  const email = `vinculo-e2e-${label}-${crypto.randomUUID()}@example.com`
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      email,
      // 32 zero bytes, base64 -- shape-valid (AccountService.PasswordVerifierLength), not a
      // real Argon2id output. This fixture never logs in with a password again.
      passwordVerifier: toBase64(new Uint8Array(32)),
      role: 'Patient',
    },
  })
  expect(response.ok(), `POST /auth/register (Patient) failed: ${response.status()} ${await response.text()}`).toBe(true)
  const body = (await response.json()) as { id: string; accessToken: string | null }
  expect(body.accessToken, 'Patient registration must return a session immediately').not.toBeNull()
  return { accountId: body.id, accessToken: body.accessToken!, email }
}

// Document + staff approval, not CRP/CRM: against the real webServer,
// CouncilRegistryVerifier.VerifyAsync throws NotSupportedException (no contracted provider), so
// this is the only path this suite can drive to an Active professional account.
export async function registrarProfissionalVerificada(request: APIRequestContext, label: string): Promise<ContaProfissional> {
  const email = `vinculo-e2e-${label}-${crypto.randomUUID()}@example.com`
  const registerResponse = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { email, passwordVerifier: toBase64(new Uint8Array(32)), role: 'Professional' },
  })
  expect(registerResponse.ok(), `POST /auth/register (Professional) failed: ${registerResponse.status()} ${await registerResponse.text()}`).toBe(true)
  const registered = (await registerResponse.json()) as { id: string; twoFactorRequirement: string; twoFactorTicket: string | null }
  expect(registered.twoFactorRequirement).toBe('SetupRequired')
  expect(registered.twoFactorTicket).not.toBeNull()
  const accountId = registered.id
  const ticket = registered.twoFactorTicket!

  const beginResponse = await request.post(`${API_BASE_URL}/accounts/${accountId}/totp`, { data: { ticket } })
  expect(beginResponse.ok(), `POST /accounts/${accountId}/totp failed: ${beginResponse.status()} ${await beginResponse.text()}`).toBe(true)
  const { secret } = (await beginResponse.json()) as { secret: string; provisioningUri: string }

  const confirmResponse = await request.post(`${API_BASE_URL}/accounts/${accountId}/totp/confirm`, {
    data: { ticket, code: computeTotpCode(secret, Math.floor(Date.now() / 1000)) },
  })
  expect(confirmResponse.ok(), `POST /accounts/${accountId}/totp/confirm failed: ${confirmResponse.status()} ${await confirmResponse.text()}`).toBe(true)
  const { accessToken } = (await confirmResponse.json()) as { accessToken: string }

  const submitResponse = await request.post(`${API_BASE_URL}/accounts/${accountId}/professional-verification`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { type: 'Document', registryNumber: null, registryUf: null, documentReference: `e2e-${label}-doc` },
  })
  expect(submitResponse.ok(), `POST .../professional-verification failed: ${submitResponse.status()} ${await submitResponse.text()}`).toBe(true)
  const submitted = (await submitResponse.json()) as { status: string }
  expect(submitted.status).toBe('InReview')

  const decisionResponse = await request.post(`${API_BASE_URL}/accounts/${accountId}/professional-verification/decision`, {
    headers: { 'X-Staff-Api-Key': STAFF_API_KEY },
    data: { approved: true, rejectionReason: null },
  })
  expect(decisionResponse.ok(), `POST .../decision failed: ${decisionResponse.status()} ${await decisionResponse.text()}`).toBe(true)
  const decided = (await decisionResponse.json()) as { status: string }
  expect(decided.status).toBe('Active')

  return { accountId, accessToken, email }
}
