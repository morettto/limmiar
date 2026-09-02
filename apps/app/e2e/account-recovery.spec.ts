import { createHmac } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL } from '../playwright.config'

// S02-06: recuperação de conta por frase BIP39. Registo e TOTP por chamadas diretas à API
// (mesmo precedente de device-pairing.spec.ts); só RecoveryPhraseSetup e RecoveryScreen passam
// pela UI real. Um `browser.newContext()` limpo faz de dispositivo que nunca teve sessão.

test.describe.configure({ mode: 'serial' })

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    expect(value, `invalid base32 character in TOTP secret: ${char}`).toBeGreaterThanOrEqual(0)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP (SHA-1, 30s step, 6 digits) -- this repo has no JS/TS TOTP library dependency, so this is a small, self-contained implementation for driving the real authenticator side of the flow in tests. */
function computeTotpCode(secretBase32: string, epochSeconds: number): string {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(epochSeconds / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const truncated =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return (truncated % 1_000_000).toString().padStart(6, '0')
}

function uniqueProfessionalEmail(label: string): string {
  return `account-recovery-e2e-${label}-${crypto.randomUUID()}@example.com`
}

/** POST /auth/register (Professional role) -- a fresh professional account always starts with twoFactorRequirement: SetupRequired (ADR-S02-03). */
async function registerProfessionalAccount(request: APIRequestContext, email: string): Promise<{ accountId: string; ticket: string }> {
  const response = await request.post(`${API_BASE_URL}/auth/register`, {
    data: {
      email,
      // 32 zero bytes, base64 -- shape-valid (AccountService.PasswordVerifierLength), not a
      // real Argon2id output. This spec never logs in with a password again.
      passwordVerifier: Buffer.alloc(32).toString('base64'),
      role: 'Professional',
    },
  })
  expect(response.ok(), `POST /auth/register failed: ${response.status()} ${await response.text()}`).toBe(true)
  const body = (await response.json()) as { id: string; twoFactorRequirement: string; twoFactorTicket: string | null }
  expect(body.twoFactorRequirement).toBe('SetupRequired')
  expect(body.twoFactorTicket).not.toBeNull()
  return { accountId: body.id, ticket: body.twoFactorTicket! }
}

/** POST /accounts/{accountId}/totp then /totp/confirm -- completes enrollment and returns the account's first real session (Spec S02, ticket S02-08 -- see TwoFactorEndpoints.cs's ConfirmTotpEnrollmentResponse doc comment). */
async function completeTotpEnrollment(
  request: APIRequestContext,
  accountId: string,
  ticket: string,
): Promise<{ accessToken: string; secret: string }> {
  const beginResponse = await request.post(`${API_BASE_URL}/accounts/${accountId}/totp`, { data: { ticket } })
  expect(beginResponse.ok(), `POST /accounts/${accountId}/totp failed: ${beginResponse.status()} ${await beginResponse.text()}`).toBe(true)
  const { secret } = (await beginResponse.json()) as { secret: string; provisioningUri: string }

  const confirmResponse = await request.post(`${API_BASE_URL}/accounts/${accountId}/totp/confirm`, {
    data: { ticket, code: computeTotpCode(secret, Math.floor(Date.now() / 1000)) },
  })
  expect(confirmResponse.ok(), `POST /accounts/${accountId}/totp/confirm failed: ${confirmResponse.status()} ${await confirmResponse.text()}`).toBe(true)
  const body = (await confirmResponse.json()) as { accessToken: string }
  return { accessToken: body.accessToken, secret }
}

/** Navigates the real RecoveryPhraseSetup screen (router.tsx's E2E-only /auth/recovery-phrase-setup route) and captures the numbered recovery phrase it displays -- the words this account can later recover access with. */
async function completeRecoveryPhraseSetupFromUi(
  page: Page,
  params: { accountId: string; accessToken: string; email: string },
): Promise<string> {
  const search = new URLSearchParams({
    baseUrl: API_BASE_URL,
    accountId: params.accountId,
    accessToken: params.accessToken,
    email: params.email,
  })
  await page.goto(`/auth/recovery-phrase-setup?${search.toString()}`)

  await expect(page.getByRole('heading', { name: 'Guarde sua frase de recuperação' })).toBeVisible()

  const wordItems = await page.locator('ol li').allTextContents()
  expect(wordItems.length, 'expected a non-empty numbered recovery phrase').toBeGreaterThan(0)
  const words = wordItems.map((item) => item.replace(/^\d+\./, ''))

  await page.getByRole('button', { name: 'Guardei minha frase' }).click()

  return words.join(' ')
}

function recoveryUrl(): string {
  return `/auth/recover?${new URLSearchParams({ baseUrl: API_BASE_URL }).toString()}`
}

test.describe('BIP39 recovery-phrase account recovery (S02-06)', () => {
  test.use({ locale: 'pt-BR' })

  test('a professional recovers access on a clean browser using their captured recovery phrase, and clears the TOTP challenge', async ({
    request,
    browser,
  }) => {
    const email = uniqueProfessionalEmail('recover')
    const { accountId, ticket } = await registerProfessionalAccount(request, email)
    const { accessToken, secret } = await completeTotpEnrollment(request, accountId, ticket)

    const setupPage = await browser.newPage()
    const mnemonic = await completeRecoveryPhraseSetupFromUi(setupPage, { accountId, accessToken, email })
    await setupPage.close()

    // A fresh context, not just a fresh page: no cookies/sessionStorage carried over from the
    // setup steps above -- this is the "clean browser, never logged in here before" scenario
    // recovery-by-phrase exists for.
    const recoveryContext = await browser.newContext({ locale: 'pt-BR' })
    const recoveryPage = await recoveryContext.newPage()

    await recoveryPage.goto(recoveryUrl())
    await recoveryPage.getByLabel('E-mail').fill(email)
    await recoveryPage.getByLabel('Frase de recuperação').fill(mnemonic)
    await recoveryPage.getByRole('button', { name: 'Recuperar acesso' }).click()

    // The account already confirmed TOTP enrollment above, so recovery must route into the
    // same TOTP challenge a normal login would (twoFactorRequirement: ChallengeRequired) --
    // not straight to a session.
    await expect(recoveryPage.getByRole('button', { name: 'Verificar' })).toBeVisible()

    await recoveryPage.getByLabel(/código/i).fill(computeTotpCode(secret, Math.floor(Date.now() / 1000)))
    await recoveryPage.getByRole('button', { name: 'Verificar' }).click()

    await expect(recoveryPage.getByRole('status')).toHaveText('Acesso recuperado com sucesso.')

    await recoveryContext.close()
  })

  test('a garbage recovery phrase is rejected with a generic message, naming no specific word', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'pt-BR' })
    const page = await context.newPage()

    await page.goto(recoveryUrl())
    await page.getByLabel('E-mail').fill(uniqueProfessionalEmail('garbage'))
    await page
      .getByLabel('Frase de recuperação')
      .fill('esta nao e uma frase valida de recuperacao bip39 apenas palavras aleatorias')
    await page.getByRole('button', { name: 'Recuperar acesso' }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveText(
      'Frase de recuperação inválida. Verifique se você digitou todas as palavras corretamente.',
    )

    for (const word of ['esta', 'nao', 'aleatorias']) {
      expect(await alert.textContent()).not.toContain(word)
    }

    await context.close()
  })
})
