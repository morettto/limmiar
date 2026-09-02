import { test, expect, type Page } from '@playwright/test'
import { API_BASE_URL } from '../playwright.config'

// S02-05: magic-link + WebAuthn para pacientes, num único contexto (um paciente, um dispositivo).
// Precisa da API a correr (playwright.config.ts), cujo MagicLink:TestCaptureEndpoint deixa ler o
// token. A biometria é um autenticador virtual do CDP, com assinaturas reais ponta a ponta.

test.describe.configure({ mode: 'serial' })

const VIRTUAL_AUTHENTICATOR_OPTIONS = {
  protocol: 'ctap2' as const,
  transport: 'internal' as const,
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
}

async function installVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: VIRTUAL_AUTHENTICATOR_OPTIONS,
  })
  return { client, authenticatorId }
}

/**
 * Installed before every navigation (`addInitScript` runs ahead of the page's own scripts) so it
 * observes the very first paint, catching a password `<input>` that rendered and was removed
 * again before any assertion ran.
 */
async function watchForPasswordInput(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2ePasswordInputSeen: boolean }
    w.__e2ePasswordInputSeen = false
    const check = () => {
      if (document.querySelector('input[type="password"]')) {
        w.__e2ePasswordInputSeen = true
      }
    }
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    check()
  })
}

async function passwordInputWasEverSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __e2ePasswordInputSeen: boolean }).__e2ePasswordInputSeen)
}

function uniquePatientEmail(label: string): string {
  return `magic-link-e2e-${label}-${crypto.randomUUID()}@example.com`
}

/** Reads the token GET /auth/magic-link/_debug-last captured for `email` -- see AuthEndpoints.cs's own doc comment on that E2E-only route. */
async function debugLastToken(page: Page, email: string): Promise<string> {
  const response = await page.request.get(`${API_BASE_URL}/auth/magic-link/_debug-last`, { params: { email } })
  expect(response.ok(), `GET /auth/magic-link/_debug-last for ${email} failed: ${response.status()} ${await response.text()}`).toBe(true)
  const body = (await response.json()) as { token: string }
  return body.token
}

function magicLinkUrl(token: string): string {
  return `/auth/magic-link?${new URLSearchParams({ baseUrl: API_BASE_URL, token }).toString()}`
}

async function readPersistedAccount(page: Page): Promise<{ id: string; email: string; role: string } | null> {
  const raw = await page.evaluate(() => window.sessionStorage.getItem('limmiar:account'))
  return raw === null ? null : (JSON.parse(raw) as { id: string; email: string; role: string })
}

/** Requests a magic link from the real A1 UI (Patient segment) -- see AuthScreenE2ESearch's own doc comment in router.tsx for why `/auth/screen` exists. */
async function requestMagicLinkFromUi(page: Page, email: string): Promise<void> {
  await page.goto(`/auth/screen?${new URLSearchParams({ baseUrl: API_BASE_URL, role: 'Patient' }).toString()}`)

  await expect(page.getByRole('radio', { name: 'Paciente' })).toBeChecked()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page.getByRole('status')).toHaveText(
    'Verifique seu e-mail para continuar. Enviamos um link de acesso, se este e-mail existir.',
  )
}

test.describe('magic-link + WebAuthn biometric login (S02-05)', () => {
  test.use({ locale: 'pt-BR' })
  // Overrides playwright.config.ts's `use.baseURL` (http://127.0.0.1:8787) -- see
  // WebAuthn:RelyingPartyId's own doc comment there for why this spec specifically needs
  // "localhost", not the IP literal every other E2E spec in this repo navigates to.
  test.use({ baseURL: 'http://localhost:8787' })

  test('first-ever patient login: registration ceremony establishes a session and never renders a password field', async ({ page }) => {
    await watchForPasswordInput(page)

    const email = uniquePatientEmail('register')
    await requestMagicLinkFromUi(page, email)

    // Installed only AFTER the first real-origin navigation: CDP's WebAuthn domain binds to the
    // page's current target, and about:blank to a real origin is cross-process in Chromium, so an
    // authenticator added earlier would be bound to a target the page has already left.
    await installVirtualAuthenticator(page)

    const token = await debugLastToken(page, email)
    await page.goto(magicLinkUrl(token))

    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    const account = await readPersistedAccount(page)
    expect(account?.email).toBe(email)
    expect(account?.role).toBe('Patient')

    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    expect(
      await passwordInputWasEverSeen(page),
      'a password <input> rendered at some point during the Patient magic-link flow',
    ).toBe(false)
  })

  test('second login for the same patient: assertion ceremony (existing credential) establishes a session', async ({ page }) => {
    await watchForPasswordInput(page)

    const email = uniquePatientEmail('assert')

    await requestMagicLinkFromUi(page, email)

    // One virtual authenticator for BOTH logins below: it stands in for the same device's
    // credential storage, which is what makes the second login a real assertion against an
    // existing credential rather than a second registration.
    await installVirtualAuthenticator(page)

    const registerToken = await debugLastToken(page, email)
    await page.goto(magicLinkUrl(registerToken))
    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    // Simulate "a later day" by clearing sessionStorage (AuthScreen/MagicLinkCallback's only
    // client-side session record) before the second magic link, so that login is proven
    // independently of the first.
    await page.evaluate(() => window.sessionStorage.clear())

    await requestMagicLinkFromUi(page, email)
    const assertToken = await debugLastToken(page, email)

    const webauthnCompleteResponse = page.waitForResponse(
      (response) => response.url().includes('/auth/magic-link/webauthn/complete') && response.request().method() === 'POST',
    )
    await page.goto(magicLinkUrl(assertToken))

    const completeResponse = await webauthnCompleteResponse
    expect(completeResponse.ok(), 'the assertion ceremony must complete against the already-registered credential').toBe(true)

    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    const account = await readPersistedAccount(page)
    expect(account?.email).toBe(email)
    expect(account?.role).toBe('Patient')
  })

  test('a magic link is rejected on its second use, not silently accepted again', async ({ page }) => {
    const email = uniquePatientEmail('replay')
    await requestMagicLinkFromUi(page, email)

    // See the first test's own comment on why this is installed only after the first
    // real-origin navigation, not before.
    await installVirtualAuthenticator(page)

    const token = await debugLastToken(page, email)

    await page.goto(magicLinkUrl(token))
    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    // Same token, opened again -- MagicLinkIssuer.ConsumeToken already burned it (TryRemove on
    // first use, see that class's own doc comment), so this must fail, not silently succeed a
    // second time.
    await page.goto(magicLinkUrl(token))

    await expect(page.getByRole('alert')).toHaveText('Este link de acesso não é mais válido. Solicite um novo.')
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('a magic link is rejected once its token has expired', async ({ page }) => {
    const email = uniquePatientEmail('expired')
    await requestMagicLinkFromUi(page, email)
    const token = await debugLastToken(page, email)

    // MagicLink:TokenLifetimeSeconds=8 (playwright.config.ts) -- wait comfortably past it
    // before attempting to open the link, same precedent as device-pairing.spec.ts's own
    // "expired QR is rejected" test.
    await page.waitForTimeout(10_000)

    await page.goto(magicLinkUrl(token))

    await expect(page.getByRole('alert')).toHaveText('Este link de acesso não é mais válido. Solicite um novo.')
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})
