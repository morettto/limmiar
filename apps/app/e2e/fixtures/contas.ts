import { expect, type APIRequestContext, type Browser } from '@playwright/test'
import { API_BASE_URL } from '../../playwright.config'
import { instalarAutenticadorVirtual, ORIGEM_PASSKEY } from './passkey'
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

/** A registered account plus the session to act as it -- same shape for Patient and Professional, only the registration path differs. */
export interface ContaTeste {
  accountId: string
  accessToken: string
}

function bearer(conta: ContaTeste): { Authorization: string } {
  return { Authorization: `Bearer ${conta.accessToken}` }
}

// Shape-valid noise (28-byte AES-GCM floor): the server stores sealed blobs and never opens them.
const SEALED_BLOB_SHAPE = toBase64(new Uint8Array(32).fill(1))

/** POST /accounts/{id}/patients -- a professional's wallet entry, the only thing a link invite can point at. */
export async function criarPacienteNaCarteira(request: APIRequestContext, profissional: ContaTeste): Promise<string> {
  const patientId = crypto.randomUUID()
  const response = await request.post(`${API_BASE_URL}/accounts/${profissional.accountId}/patients`, {
    headers: bearer(profissional),
    data: { patientId, wrappedDek: SEALED_BLOB_SHAPE, ciphertext: SEALED_BLOB_SHAPE },
  })
  expect(response.ok(), `POST /accounts/${profissional.accountId}/patients failed: ${response.status()} ${await response.text()}`).toBe(true)
  return patientId
}

/** POST .../patients/{patientId}/link-invites -- the single-use code the professional hands to the patient. */
export async function criarConvite(request: APIRequestContext, profissional: ContaTeste, patientId: string): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/accounts/${profissional.accountId}/patients/${patientId}/link-invites`, {
    headers: bearer(profissional),
  })
  expect(response.ok(), `POST .../link-invites failed: ${response.status()} ${await response.text()}`).toBe(true)
  return ((await response.json()) as { code: string }).code
}

/**
 * An anonymous Patient account only exists once an invite is redeemed with a passkey, so this runs
 * the real ceremony in a throwaway context, then unlinks the issuing professional: the account
 * starts with no link, ready for the invite a spec wants to exercise.
 */
export async function registrarPaciente(browser: Browser, request: APIRequestContext, label: string): Promise<ContaTeste> {
  const convidante = await registrarProfissionalVerificada(request, `convite-${label}`)
  const codigo = await criarConvite(request, convidante, await criarPacienteNaCarteira(request, convidante))

  const context = await browser.newContext({ baseURL: ORIGEM_PASSKEY, locale: 'pt-BR' })
  try {
    const page = await context.newPage()
    await page.goto('/')
    await instalarAutenticadorVirtual(page)
    await page.goto(`/auth/magic-link?${new URLSearchParams({ token: codigo }).toString()}`)
    await page.getByRole('button', { name: 'Confirmar meu acesso' }).click()
    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')
    const raw = await page.evaluate(() => window.sessionStorage.getItem('limmiar:account'))
    const { id, accessToken } = JSON.parse(raw!) as { id: string; accessToken: string }
    const conta = { accountId: id, accessToken }

    const unlink = await request.delete(`${API_BASE_URL}/accounts/${id}/links/${convidante.accountId}`, { headers: bearer(conta) })
    expect(unlink.status(), `DELETE .../links/${convidante.accountId} failed: ${await unlink.text()}`).toBe(204)
    return conta
  } finally {
    await context.close()
  }
}

// Document + staff approval, not CRP/CRM: against the real webServer,
// CouncilRegistryVerifier.VerifyAsync throws NotSupportedException (no contracted provider), so
// this is the only path this suite can drive to an Active professional account.
export async function registrarProfissionalVerificada(request: APIRequestContext, label: string): Promise<ContaTeste> {
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

  return { accountId, accessToken }
}
