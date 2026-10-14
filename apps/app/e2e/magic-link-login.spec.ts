import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE_URL } from '../playwright.config'
import { criarConvite, criarPacienteNaCarteira, registrarProfissionalVerificada, type ContaTeste } from './fixtures/contas'
import { instalarAutenticadorVirtual, ORIGEM_PASSKEY } from './fixtures/passkey'

// S02-05: convite anônimo + WebAuthn para pacientes, num único contexto (um paciente, um
// dispositivo). A conta do paciente só nasce quando ele confirma um convite da profissional com
// a passkey; a biometria é um autenticador virtual do CDP, com assinaturas reais ponta a ponta.

test.describe.configure({ mode: 'serial' })

const LINK_INVALIDO = 'Este link de acesso não é mais válido. Solicite um novo.'

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

function magicLinkUrl(token: string): string {
  // O host da API desta rota entra pelo VITE_API_BASE_URL do build (playwright.config.ts), não por aqui.
  return `/auth/magic-link?${new URLSearchParams({ token }).toString()}`
}

async function readPersistedAccount(page: Page): Promise<{ id: string; email: string | null; role: string } | null> {
  const raw = await page.evaluate(() => window.sessionStorage.getItem('limmiar:account'))
  return raw === null ? null : (JSON.parse(raw) as { id: string; email: string | null; role: string })
}

/** Real-origin navigation first, then the authenticator: see instalarAutenticadorVirtual's own comment. */
async function abrirEntradaComAutenticador(page: Page): Promise<void> {
  await page.goto('/')
  await instalarAutenticadorVirtual(page)
}

async function confirmarAcesso(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirmar meu acesso' }).click()
}

let profissional: ContaTeste

async function novoConvite(request: APIRequestContext, patientId?: string): Promise<{ codigo: string; patientId: string }> {
  const id = patientId ?? (await criarPacienteNaCarteira(request, profissional))
  return { codigo: await criarConvite(request, profissional, id), patientId: id }
}

test.beforeAll(async ({ request }) => {
  profissional = await registrarProfissionalVerificada(request, 'magic-link')
})

test.describe('convite anônimo + WebAuthn biometric login (S02-05)', () => {
  test.use({ locale: 'pt-BR' })
  // Overrides playwright.config.ts's `use.baseURL` (http://127.0.0.1:8787) -- see
  // WebAuthn:RelyingPartyId's own doc comment there for why this spec specifically needs
  // "localhost", not the IP literal every other E2E spec in this repo navigates to.
  test.use({ baseURL: ORIGEM_PASSKEY })

  test('first-ever patient login: registration ceremony establishes a session and never renders a password field', async ({ page, request }) => {
    const { codigo } = await novoConvite(request)
    await abrirEntradaComAutenticador(page)
    await watchForPasswordInput(page)

    await page.goto(magicLinkUrl(codigo))
    await confirmarAcesso(page)

    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    const account = await readPersistedAccount(page)
    expect(account?.email).toBeNull()
    expect(account?.role).toBe('Patient')

    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    expect(
      await passwordInputWasEverSeen(page),
      'a password <input> rendered at some point during the Patient invitation flow',
    ).toBe(false)
  })

  test('a patient types the invitation code on the entry screen: no password field, and lands on their own screen', async ({ page, request }) => {
    const { codigo } = await novoConvite(request)
    await abrirEntradaComAutenticador(page)

    await page.getByRole('radio', { name: 'Paciente' }).check()
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await page.getByLabel('Código de acesso recebido do profissional').fill(codigo)
    await page.getByRole('button', { name: 'Continuar com meu código' }).click()
    await confirmarAcesso(page)

    await expect(page).toHaveURL(/\/hoje$/)
    const account = await readPersistedAccount(page)
    expect(account?.email).toBeNull()
    expect(account?.role).toBe('Patient')
  })

  test('second login for the same patient: assertion ceremony (existing credential) establishes a session', async ({ page, request }) => {
    const first = await novoConvite(request)

    // One virtual authenticator for BOTH logins below: it stands in for the same device's
    // credential storage, which is what makes the second login a real assertion against an
    // existing credential rather than a second registration.
    await abrirEntradaComAutenticador(page)

    await page.goto(magicLinkUrl(first.codigo))
    await confirmarAcesso(page)
    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')
    const registered = await readPersistedAccount(page)

    // Simulate "a later day" by clearing sessionStorage (the only client-side session record)
    // before the second invite, so that login is proven independently of the first.
    await page.evaluate(() => window.sessionStorage.clear())

    const second = await novoConvite(request, first.patientId)
    await page.goto(magicLinkUrl(second.codigo))

    const webauthnCompleteResponse = page.waitForResponse(
      (response) => response.url().includes('/auth/magic-link/webauthn/complete') && response.request().method() === 'POST',
    )
    await confirmarAcesso(page)

    const completeResponse = await webauthnCompleteResponse
    expect(completeResponse.ok(), 'the assertion ceremony must complete against the already-registered credential').toBe(true)

    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    const account = await readPersistedAccount(page)
    expect(account?.id).toBe(registered?.id)
    expect(account?.role).toBe('Patient')
  })

  test('an invite is rejected on its second use, not silently accepted again', async ({ page, request }) => {
    const { codigo } = await novoConvite(request)
    await abrirEntradaComAutenticador(page)

    await page.goto(magicLinkUrl(codigo))
    await confirmarAcesso(page)
    await expect(page.getByRole('status')).toHaveText('Login realizado com sucesso.')

    // Same code, opened again -- the first ceremony already consumed it (DELETE ... in the same
    // transaction as the account insert), so this must fail, not silently succeed a second time.
    await page.goto(magicLinkUrl(codigo))
    await confirmarAcesso(page)

    await expect(page.getByRole('alert')).toHaveText(LINK_INVALIDO)
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('an invite the professional revoked is rejected before any ceremony starts', async ({ page, request }) => {
    const { codigo, patientId } = await novoConvite(request)

    const revoke = await request.delete(`${API_BASE_URL}/accounts/${profissional.accountId}/patients/${patientId}/link-invites`, {
      headers: { Authorization: `Bearer ${profissional.accessToken}` },
    })
    expect(revoke.status()).toBe(204)

    await page.goto(magicLinkUrl(codigo))
    await confirmarAcesso(page)

    await expect(page.getByRole('alert')).toHaveText(LINK_INVALIDO)
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})
