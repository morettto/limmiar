import { test, expect, type Page } from '@playwright/test'
import { API_BASE_URL } from '../playwright.config'

// S02-05: magic-link + WebAuthn biometric login for patients. Single browser context/page --
// one patient, one device -- unlike device-pairing.spec.ts's dual-context tests (this ticket's
// flow never involves a second physical device). A real, running instance of this repo's own
// API is required (same webServer as device-pairing.spec.ts, playwright.config.ts's third
// entry); its MagicLink:TestCaptureEndpoint=true override is what lets `debugLastToken` below
// read back a token this repo has no real e-mail infrastructure to deliver.
//
// The "biometric" itself is simulated with a Chrome DevTools Protocol virtual authenticator
// (WebAuthn.addVirtualAuthenticator) -- a real cryptographic authenticator implementation the
// browser talks to over the actual navigator.credentials.create()/get() APIs AuthScreen's
// webauthn.ts calls, not a stub of those APIs. Every ceremony in this file produces and
// verifies real signatures end to end (Api.Accounts.WebAuthnCeremonyVerifier, server-side).

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
 * Installed before every navigation (Playwright's `addInitScript` runs ahead of the page's own
 * scripts, on every subsequent navigation too) so it can observe the very first paint --
 * catching a password `<input>` that rendered and was removed again before any assertion ran,
 * not just one still present when a `locator` check happens to run.
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

    // Installed only AFTER the first real-origin navigation above (not before, while `page`
    // still sits on `about:blank`): CDP's WebAuthn domain is attached to the page's current
    // target, and `about:blank` -> a real http(s) origin is a cross-process navigation in
    // Chromium's site-isolation model -- an authenticator added beforehand would end up bound
    // to a target this page has already left, and `navigator.credentials.create()` would then
    // hang forever waiting for a (nonexistent, in headless mode) real platform authenticator.
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

    // One virtual authenticator, attached once (after the first real-origin navigation --
    // same "about:blank is cross-process" reasoning as the previous test), used for BOTH
    // magic-link logins below -- it stands in for "the same physical device's secure-enclave
    // credential storage", which is exactly what makes the second login a real assertion
    // against an EXISTING credential (Api.Accounts.AccountService.VerifyMagicLinkAsync issues
    // Assert, not Register, once the account already has a stored WebAuthnCredentialId)
    // rather than a second registration.
    await installVirtualAuthenticator(page)

    const registerToken = await debugLastToken(page, email)
    await page.goto(magicLinkUrl(registerToken))
    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    // Simulate "a later day" by clearing this session's own in-memory state (sessionStorage,
    // AuthScreen/MagicLinkCallback's only client-side session record -- see
    // AuthScreen.tsx's ACCOUNT_SESSION_STORAGE_KEY doc comment) before requesting the second
    // magic link, so this second login is proven independently of the first, not merely a
    // page that happened to still be "logged in".
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
