import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import type { MicrofoneAutorizado } from '../../features/live-session/microfone'
import { ESTADO_PENDENTE } from '../../entities/nota/nota'
import type { Account } from '../../entities/account'

const ACCOUNT: Account = {
  id: '99999999-9999-9999-9999-999999999999',
  email: 'sessao@example.com',
  role: 'Professional',
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

function seedStoredAccount(account: Account) {
  window.sessionStorage.setItem('limmiar:account', JSON.stringify(account))
}

// S18-07: `registar()` nunca persiste `twoFactorTicket` -- as asserções contra o sessionStorage
// bruto comparam com esta forma, não com `JSON.stringify(ACCOUNT)`.
function contaPersistidaJson(account: Account): string {
  const { twoFactorTicket: _twoFactorTicket, ...semTicket } = account
  return JSON.stringify(semTicket)
}

vi.mock('../../widgets/auth-screen/AuthScreen', () => ({ AuthScreen: vi.fn(() => <div data-testid="auth-screen" />) }))
vi.mock('../../features/magic-link-auth/MagicLinkCallback', () => ({
  MagicLinkCallback: vi.fn(() => <div data-testid="magic-link-callback" />),
}))
vi.mock('../../features/recovery/RecoveryScreen', () => ({
  RecoveryScreen: vi.fn(() => <div data-testid="recovery-screen" />),
}))
vi.mock('../../features/recovery/RecoveryPhraseSetup', () => ({
  RecoveryPhraseSetup: vi.fn(() => <div data-testid="recovery-phrase-setup" />),
}))
vi.mock('../../features/device-pairing-primary/PairPrimaryDevice', () => ({
  PairPrimaryDevice: vi.fn(() => <div data-testid="pair-primary-device" />),
}))
vi.mock('../../features/device-pairing-new/PairNewDevice', () => ({
  PairNewDevice: vi.fn(() => <div data-testid="pair-new-device" />),
}))
vi.mock('../../features/copilot-byok/CopilotKeySetup', () => ({
  CopilotKeySetup: vi.fn(() => <div data-testid="copilot-key-setup" />),
}))
vi.mock('../../widgets/soap-editor/FilaEEditor', () => ({
  FilaEEditor: vi.fn(() => <div data-testid="fila-e-editor" />),
}))
vi.mock('../../pages/biblioteca/BibliotecaPage', () => ({
  BibliotecaPage: vi.fn(() => <div data-testid="biblioteca-page" />),
}))
vi.mock('../../features/live-session/microfone', () => ({
  abrirMicrofone: vi.fn(),
}))

// Route construction runs once at module top level, so each test needs its own fresh evaluation —
// both to pick up window.history's current URL as the initial match and to choose either branch of
// the VITE_ENABLE_E2E_TEST_ROUTES ternary via vi.stubEnv.
async function loadRouterAt(url: string, enableE2ERoutes = false) {
  window.history.pushState({}, '', url)
  if (enableE2ERoutes) {
    vi.stubEnv('VITE_ENABLE_E2E_TEST_ROUTES', 'true')
  }
  vi.resetModules()
  const { router } = await import('./router')
  return router
}

// `vi.resetModules()` gives router.tsx a fresh `SessionContext`; a static `<SessionProvider>`
// import would be a different instance, so `useSession()` in the fresh router would still throw.
// Wraps every route in both providers unconditionally -- a no-op for routes needing neither.
async function renderRouter(router: Awaited<ReturnType<typeof loadRouterAt>>) {
  const { SessionProvider } = await import('../providers/SessionProvider')
  return render(
    <I18nProvider i18n={i18n}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </I18nProvider>,
  )
}

describe('router', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    window.history.pushState({}, '', '/')
    window.sessionStorage.clear()
    delete (window as unknown as Record<string, unknown>).__e2eDecodeQr
    delete (window as unknown as Record<string, unknown>).__e2eKekAdopted
  })

  it('does not register the E2E-only routes when VITE_ENABLE_E2E_TEST_ROUTES is unset', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional')

    await renderRouter(router)

    expect(screen.queryByTestId('auth-screen')).toBeNull()
    expect(router.state.matches.some((match) => match.routeId === '/auth/screen')).toBe(false)
  })

  it('resolves the index route ("/") and renders the app shell, with no "Sair" button when there is no session', async () => {
    const router = await loadRouterAt('/')

    await renderRouter(router)

    const shell = await screen.findByText('Limmiar')

    expect(shell.id).toBe('app-shell')
    expect(shell.textContent).toContain('Limmiar')
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
    expect(screen.queryByTestId('conta-sessao')).toBeNull()

    const matches = router.state.matches
    expect(matches).toHaveLength(2)
    expect(matches[0]?.routeId).toBe('__root__')
    expect(matches[1]?.routeId).toBe('/')
    expect(matches[1]?.fullPath).toBe('/')
  })

  it('the index route shows the account email and a "Sair" button with a session; clicking it calls terminarSessao', async () => {
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/')

    await renderRouter(router)
    await screen.findByText('Limmiar')

    expect(screen.getByTestId('conta-sessao').textContent).toBe(ACCOUNT.email)
    // Semeado diretamente via seedStoredAccount (não passou por registar()) -- storage bruto
    // continua igual ao que foi semeado.
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(JSON.stringify(ACCOUNT))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    })

    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
  })

  it('resolves /settings/copilot with a locked keychain and an empty accountId, and its onDone navigates back to "/"', async () => {
    const router = await loadRouterAt('/settings/copilot')

    await renderRouter(router)
    await screen.findByTestId('copilot-key-setup')

    const { CopilotKeySetup } = await import('../../features/copilot-byok/CopilotKeySetup')
    const props = vi.mocked(CopilotKeySetup).mock.calls[0]![0]
    expect(props.accountId).toBe('')
    expect(props.kek).toBeNull()

    await act(async () => {
      props.onDone()
    })

    expect(router.state.location.pathname).toBe('/')
  })

  it('resolves /settings/copilot with the real accountId from a live session', async () => {
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/settings/copilot')
    await renderRouter(router)
    await screen.findByTestId('copilot-key-setup')

    const { CopilotKeySetup } = await import('../../features/copilot-byok/CopilotKeySetup')
    const props = vi.mocked(CopilotKeySetup).mock.calls[0]![0]
    expect(props.accountId).toBe(ACCOUNT.id)
  })

  it('the index route offers a link to /settings/copilot', async () => {
    const router = await loadRouterAt('/')

    await renderRouter(router)
    await screen.findByText('Limmiar')

    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: 'Configurar copiloto de IA' }))
    })

    expect(router.state.location.pathname).toBe('/settings/copilot')
  })

  it('resolves /notas and mounts FilaEEditor with a single in-memory nota fixture (pendente, S/O/A/P)', async () => {
    const router = await loadRouterAt('/notas')

    await renderRouter(router)
    await screen.findByTestId('fila-e-editor')

    const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
    const props = vi.mocked(FilaEEditor).mock.calls[0]![0]
    expect(props.notas).toHaveLength(1)
    expect(props.notas[0]!.estado).toBe(ESTADO_PENDENTE)
    expect(props.notas[0]!.frases.map((frase) => frase.secao)).toEqual(['S', 'O', 'A', 'P'])
  })

  it('/notas: aoTocar toca a âncora no reprodutor real (fatia 3)', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const router = await loadRouterAt('/notas')
    await renderRouter(router)
    await screen.findByTestId('fila-e-editor')

    const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
    const props = vi.mocked(FilaEEditor).mock.calls[0]![0]

    expect(props.aoTocar({ inicioMs: 2500, fimMs: 3000 })).toBeUndefined()
    expect(play).toHaveBeenCalledTimes(1)

    play.mockRestore()
  })

  it('/notas: onChangeNota atualiza a nota em memória, refletida na renderização seguinte', async () => {
    const router = await loadRouterAt('/notas')
    await renderRouter(router)
    await screen.findByTestId('fila-e-editor')

    const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
    const props = vi.mocked(FilaEEditor).mock.calls[0]![0]
    const notaId = props.notas[0]!.id
    const notaEditada = { ...props.notas[0]!, revisao: 1 }

    await act(async () => {
      props.onChangeNota(notaEditada)
    })

    const propsDepois = vi.mocked(FilaEEditor).mock.calls.at(-1)![0]
    expect(propsDepois.notas.find((nota) => nota.id === notaId)).toEqual(notaEditada)
  })

  // NotaPage ainda não tem sessão/keychain real nesta rota: aoAssinar tenta a cadeia real e falha
  // com as credenciais fixture, caindo no mesmo caminho de falha de rede (item pendente, role=alert).
  // O caminho de sucesso é coberto por NotaPage.test.tsx com os módulos duplados.
  it('/notas: aoAssinar sem sessão real cai no caminho de falha de rede -- item continua pendente', async () => {
    const router = await loadRouterAt('/notas')
    await renderRouter(router)
    await screen.findByTestId('fila-e-editor')

    const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
    const props = vi.mocked(FilaEEditor).mock.calls[0]![0]

    await act(async () => {
      await (props.aoAssinar(props.notas[0]!) as unknown as Promise<void>)
    })

    const propsDepois = vi.mocked(FilaEEditor).mock.calls.at(-1)![0]
    expect(propsDepois.notas[0]!.estado).toBe(ESTADO_PENDENTE)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  // BibliotecaPage é mockado aqui (não BibliotecaNotas): a fixture desta rota é o próprio
  // `store`, então o teste chama `ler`/`gravar` diretamente em vez de depender de
  // BibliotecaPage os invocar -- o que só aconteceria com um dek real, fora desta fatia.
  it('resolves /biblioteca com fixtures vazias e chaveIndice=null; o store fixture nunca acha nada persistido', async () => {
    const router = await loadRouterAt('/biblioteca')

    await renderRouter(router)
    await screen.findByTestId('biblioteca-page')

    const { BibliotecaPage } = await import('../../pages/biblioteca/BibliotecaPage')
    const props = vi.mocked(BibliotecaPage).mock.calls[0]![0]
    expect(props.notas).toEqual([])
    expect(props.accountId).toBe('')
    expect(props.chaveIndice).toBeNull()
    await expect(props.store.ler()).resolves.toBeNull()
    await expect(props.store.gravar(new Uint8Array())).resolves.toBeUndefined()
    await expect(props.store.apagar()).resolves.toBeUndefined()
  })

  it('resolves /biblioteca with the real accountId from a live session', async () => {
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/biblioteca')
    await renderRouter(router)
    await screen.findByTestId('biblioteca-page')

    const { BibliotecaPage } = await import('../../pages/biblioteca/BibliotecaPage')
    const props = vi.mocked(BibliotecaPage).mock.calls[0]![0]
    expect(props.accountId).toBe(ACCOUNT.id)
  })

  it('resolves /auth/magic-link and passes baseUrl/token through to MagicLinkCallback', async () => {
    const router = await loadRouterAt('/auth/magic-link?baseUrl=http%3A%2F%2Fapi.test&token=tok-123')

    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.token).toBe('tok-123')
  })

  it('/auth/magic-link wires onAuthenticated to iniciarSessao -- calling it records the session', async () => {
    const router = await loadRouterAt('/auth/magic-link?baseUrl=http%3A%2F%2Fapi.test&token=tok-123')
    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    act(() => {
      props.onAuthenticated?.(ACCOUNT)
    })

    expect(window.sessionStorage.getItem('limmiar:account')).toBe(contaPersistidaJson(ACCOUNT))
  })

  it('/auth/magic-link falls back to empty strings when baseUrl/token are absent from the query string', async () => {
    const router = await loadRouterAt('/auth/magic-link')

    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('')
    expect(props.token).toBe('')
  })

  it('/auth/screen (E2E-only) forwards baseUrl, derives a Professional initialRole, and its getGoogleIdToken always rejects', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional', true)

    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.initialRole).toBe('Professional')
    await expect(props.getGoogleIdToken()).rejects.toThrow(
      '/auth/screen is E2E-only scaffolding for magic-link-login.spec.ts, which never clicks the Google button.',
    )
  })

  it('/auth/screen (E2E-only) wires onAuthenticated to iniciarSessao -- calling it records the session', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional', true)
    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    act(() => {
      props.onAuthenticated?.(ACCOUNT)
    })

    expect(window.sessionStorage.getItem('limmiar:account')).toBe(contaPersistidaJson(ACCOUNT))
  })

  it('/auth/screen (E2E-only) derives a Patient initialRole', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Patient', true)

    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.initialRole).toBe('Patient')
  })

  it('/auth/screen (E2E-only) falls back to an undefined initialRole for any other role value', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=bogus', true)

    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.initialRole).toBeUndefined()
  })

  it('resolves /auth/recover (E2E-only) and passes baseUrl through to RecoveryScreen', async () => {
    const router = await loadRouterAt('/auth/recover?baseUrl=http%3A%2F%2Fapi.test', true)

    await renderRouter(router)
    await screen.findByTestId('recovery-screen')

    const { RecoveryScreen } = await import('../../features/recovery/RecoveryScreen')
    expect(vi.mocked(RecoveryScreen).mock.calls[0]![0].baseUrl).toBe('http://api.test')
  })

  it('/auth/recover (E2E-only) wires onRecovered to iniciarSessao -- calling it records the session', async () => {
    const router = await loadRouterAt('/auth/recover?baseUrl=http%3A%2F%2Fapi.test', true)
    await renderRouter(router)
    await screen.findByTestId('recovery-screen')

    const { RecoveryScreen } = await import('../../features/recovery/RecoveryScreen')
    const props = vi.mocked(RecoveryScreen).mock.calls[0]![0]
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    act(() => {
      props.onRecovered?.(ACCOUNT)
    })

    expect(window.sessionStorage.getItem('limmiar:account')).toBe(contaPersistidaJson(ACCOUNT))
  })

  it('resolves /auth/recovery-phrase-setup (E2E-only), passes every search param through, and onDone is a no-op', async () => {
    const router = await loadRouterAt(
      '/auth/recovery-phrase-setup?baseUrl=http%3A%2F%2Fapi.test&accountId=acc-1&accessToken=tok-1&email=a%40b.com',
      true,
    )

    await renderRouter(router)
    await screen.findByTestId('recovery-phrase-setup')

    const { RecoveryPhraseSetup } = await import('../../features/recovery/RecoveryPhraseSetup')
    const props = vi.mocked(RecoveryPhraseSetup).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.accountId).toBe('acc-1')
    expect(props.accessToken).toBe('tok-1')
    expect(props.email).toBe('a@b.com')
    expect(props.onDone()).toBeUndefined()
  })

  it('resolves /devices/pair-primary (E2E-only) and its getKekForTransfer decodes the kek query param', async () => {
    const kek = new Uint8Array(32).fill(7)
    const router = await loadRouterAt(
      `/devices/pair-primary?baseUrl=http%3A%2F%2Fapi.test&accountId=acc-1&accessToken=tok-1&kek=${encodeURIComponent(encodeBase64(kek))}`,
      true,
    )

    await renderRouter(router)
    await screen.findByTestId('pair-primary-device')

    const { PairPrimaryDevice } = await import('../../features/device-pairing-primary/PairPrimaryDevice')
    const props = vi.mocked(PairPrimaryDevice).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.accountId).toBe('acc-1')
    expect(props.accessToken).toBe('tok-1')
    await expect(props.getKekForTransfer()).resolves.toEqual(kek)
  })

  it('resolves /devices/pair-new (E2E-only); decode rejects and onKekAdopted no-ops when the E2E window hooks are not installed', async () => {
    const router = await loadRouterAt('/devices/pair-new?baseUrl=http%3A%2F%2Fapi.test', true)

    await renderRouter(router)
    await screen.findByTestId('pair-new-device')

    const { PairNewDevice } = await import('../../features/device-pairing-new/PairNewDevice')
    const props = vi.mocked(PairNewDevice).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    await expect(props.decode!()).rejects.toThrow('window.__e2eDecodeQr is not installed -- this route is E2E-only.')
    expect(() => props.onKekAdopted(new Uint8Array([1, 2, 3]))).not.toThrow()
  })

  it('/devices/pair-new decode() and onKekAdopted() delegate to the installed E2E window hooks', async () => {
    const router = await loadRouterAt('/devices/pair-new?baseUrl=http%3A%2F%2Fapi.test', true)
    const e2eDecodeQr = vi.fn().mockResolvedValue('decoded-text')
    const e2eKekAdopted = vi.fn()
    Object.assign(window, { __e2eDecodeQr: e2eDecodeQr, __e2eKekAdopted: e2eKekAdopted })

    await renderRouter(router)
    await screen.findByTestId('pair-new-device')

    const { PairNewDevice } = await import('../../features/device-pairing-new/PairNewDevice')
    const props = vi.mocked(PairNewDevice).mock.calls[0]![0]

    await expect(props.decode!()).resolves.toBe('decoded-text')
    expect(e2eDecodeQr).toHaveBeenCalledTimes(1)

    const kek = new Uint8Array([9, 9, 9])
    props.onKekAdopted(kek)
    expect(e2eKekAdopted).toHaveBeenCalledWith(encodeBase64(kek))
  })

  it('resolves /e2e/microfone (E2E-only): forwards a valid consentimento to abrirMicrofone and shows an alert on refusal', async () => {
    const { abrirMicrofone } = await import('../../features/live-session/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({ ok: false, motivo: 'consentimento-ausente' })

    const router = await loadRouterAt('/e2e/microfone?consentimento=revogado', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect(abrirMicrofone).toHaveBeenCalledWith('revogado')
    expect((await screen.findByRole('alert')).textContent).toContain('consentimento-ausente')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('/e2e/microfone falls back to "pendente" when consentimento is absent from the query string', async () => {
    const { abrirMicrofone } = await import('../../features/live-session/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({ ok: false, motivo: 'consentimento-ausente' })

    const router = await loadRouterAt('/e2e/microfone', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect(abrirMicrofone).toHaveBeenCalledWith('pendente')
    await screen.findByRole('alert')
  })

  it('/e2e/microfone falls back to "pendente" when consentimento is not one of the three known states', async () => {
    const { abrirMicrofone } = await import('../../features/live-session/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({ ok: false, motivo: 'consentimento-ausente' })

    const router = await loadRouterAt('/e2e/microfone?consentimento=bogus', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect(abrirMicrofone).toHaveBeenCalledWith('pendente')
    await screen.findByRole('alert')
  })

  it('/e2e/microfone shows a status when abrirMicrofone succeeds', async () => {
    const { abrirMicrofone } = await import('../../features/live-session/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({
      ok: true,
      // A porta está mockada aqui, logo ninguém a atravessa para receber a marca nominal:
      // o cast é do duplo, não de código de produção.
      microfone: { stream: {} as MediaStream } as MicrofoneAutorizado,
    })

    const router = await loadRouterAt('/e2e/microfone?consentimento=concedido', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect((await screen.findByRole('status')).textContent).toContain('microfone aberto')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
