import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import type { MicrofoneAutorizado } from '../../entities/consentimento/microfone'
import type { Account } from '../../entities/account'
import { webcrypto } from '@limmiar/crypto'

const ACCOUNT: Account = {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
vi.mock('../../pages/settings/CopilotPage', () => ({ CopilotPage: vi.fn(() => <div data-testid="copilot-page" />) }))
vi.mock('../../pages/home/HomePage', () => ({
  HomePage: vi.fn(() => <div data-testid="home-page" />),
}))
vi.mock('../../pages/online-session/OnlineSessionPage', () => ({ OnlineSessionPage: vi.fn(() => <div data-testid="online-session-page" />) }))
vi.mock('../../pages/prontuario/ProntuarioPage', () => ({
  ProntuarioPage: vi.fn(() => <div data-testid="prontuario-page" />),
}))
vi.mock('../../pages/pacientes/PacientesPage', () => ({
  PacientesPage: vi.fn(() => <div data-testid="pacientes-page" />),
}))
vi.mock('../../pages/atendimento/AtendimentoPage', () => ({
  AtendimentoPage: vi.fn(() => <div data-testid="atendimento-page" />),
}))
vi.mock('../../features/prontuario/ProntuarioProvider', () => ({
  ProntuarioProvider: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="prontuario-provider">{children}</div>),
}))
vi.mock('../../pages/biblioteca/BibliotecaAccountPage', () => ({
  BibliotecaAccountPage: vi.fn(() => <div data-testid="biblioteca-page" />),
}))
vi.mock('../../pages/acervo/AcervoPage', () => ({ AcervoPage: vi.fn(() => <div data-testid="acervo-page" />) }))
vi.mock('../../features/voice-enrollment/VoiceSettings', () => ({ VoiceSettings: vi.fn(() => <div data-testid="voice-settings" />) }))
vi.mock('../../pages/settings/AuditPage', () => ({ AuditPage: vi.fn(() => <div data-testid="audit-page" />) }))
vi.mock('../../features/partilha/EspelhoP6', () => ({ EspelhoP6: vi.fn(() => <div data-testid="espelho-p6" />) }))
vi.mock('../../features/partilha/PartilhaCheckIns', () => ({ PartilhaCheckIns: vi.fn(() => <div data-testid="partilha-check-ins" />) }))
vi.mock('../../entities/consentimento/microfone', () => ({
  abrirMicrofone: vi.fn(),
}))
vi.mock('../../widgets/contacto-emergencia/ContactoEmergencia', () => ({
  ContactoEmergencia: vi.fn(() => <div data-testid="contacto-emergencia" />),
}))
vi.mock('../../pages/paciente-hoje/PacienteHojePage', () => ({
  PacienteHojePage: vi.fn(() => <div data-testid="paciente-hoje-page" />),
}))
vi.mock('./E2eVinculoScaffold', () => ({
  E2eVinculoScaffold: vi.fn(
    ({ papel, patientId }: { papel: string; patientId: string }) => (
      <div data-testid="e2e-vinculo-scaffold" data-papel={papel} data-patient-id={patientId} />
    ),
  ),
}))
vi.mock('./E2ePartilhaScaffold', () => ({
  E2ePartilhaScaffold: vi.fn(({ papel, agora }: { papel: string; agora: string }) => (
    <div data-testid="e2e-partilha-scaffold" data-papel={papel} data-agora={agora} />
  )),
}))

const PATIENT_ACCOUNT: Account = {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
  id: '88888888-8888-8888-8888-888888888888',
  role: 'Patient', email: null,
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

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
  it('abre convite online sem exigir login ou identidade do paciente', async () => {
    const router = await loadRouterAt('/session/online#room=sala&token=credencial')
    await renderRouter(router)
    await screen.findByTestId('online-session-page')
    expect(screen.queryByTestId('auth-screen')).toBeNull()
  }, 20_000) // primeiro teste do arquivo paga a importação fria do router inteiro sob cobertura
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

  it('requires authentication at the index route ("/")', async () => {
    const router = await loadRouterAt('/')

    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const matches = router.state.matches
    expect(matches).toHaveLength(2)
    expect(matches[0]?.routeId).toBe('__root__')
    expect(matches[1]?.routeId).toBe('/')
    expect(matches[1]?.fullPath).toBe('/')
  })
  it('abre o consultório com a sessão completa e a chave desbloqueada', async () => {
    const router = await loadRouterAt('/')
    const { SessionProvider } = await import('../providers/SessionProvider')
    const { useSession } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(7))
    function Desbloquear() {
      const { iniciarSessao } = useSession()
      return <button onClick={() => iniciarSessao(ACCOUNT, kek)}>Desbloquear</button>
    }
    render(<I18nProvider i18n={i18n}><SessionProvider><Desbloquear /><RouterProvider router={router} /></SessionProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }))
    await screen.findByTestId('home-page')
    const { HomePage } = await import('../../pages/home/HomePage')
    expect(vi.mocked(HomePage).mock.lastCall![0].chaveiro).toEqual({ kek, accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken })
  })
  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/acervo exige sessão profissional desbloqueada: %s', async condicao => {
    const router = await loadRouterAt('/acervo')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT, role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const, accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}><RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('acervo-page')).toBeNull()
  })
  it('/acervo recebe as credenciais e a chave desbloqueada sem URL com identidade do paciente', async () => {
    const router = await loadRouterAt('/acervo')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}><RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('acervo-page')
    const { AcervoPage } = await import('../../pages/acervo/AcervoPage')
    expect(vi.mocked(AcervoPage).mock.lastCall![0]).toMatchObject({ accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken, kek })
    const barra = screen.getByRole('banner')
    expect(within(barra).getByRole('navigation', { name: 'Navegação principal' })).toBeTruthy()
    expect(barra.compareDocumentPosition(screen.getByTestId('acervo-page')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('combobox', { name: 'Idioma' })).toEqual([within(barra).getByRole('combobox', { name: 'Idioma' })])
  })

  it.each([
    ['/', 'Consultório'],
    ['/acervo', 'Acervo pessoal'],
    ['/pacientes', 'Pacientes'],
    ['/pacientes/paciente-1', 'Pacientes'],
    ['/pacientes/paciente-1/sessoes/atendimento-3?aba=nota', 'Pacientes'],
    ['/biblioteca', 'Biblioteca de notas'],
    ['/espelho', 'Sinais compartilhados pelos pacientes'],
  ])('na árvore de rotas real, %s marca só "%s" na barra', async (caminho, ativo) => {
    const router = await loadRouterAt(caminho)
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}><RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    const principal = await screen.findByRole('navigation', { name: 'Navegação principal' })
    expect(within(principal).getAllByRole('link', { current: 'page' }).map(link => link.textContent)).toEqual([ativo])
  })

  it.each(['sem sessão', 'paciente'])('/settings/copilot exige conta profissional: %s', async (condicao) => {
    const router = await loadRouterAt('/settings/copilot')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : PATIENT_ACCOUNT
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek: null, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('copilot-page')).toBeNull()
  })

  it('/settings/copilot recebe a conta da sessão profissional', async () => {
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/settings/copilot')
    await renderRouter(router)
    await screen.findByTestId('copilot-page')
    const { CopilotPage } = await import('../../pages/settings/CopilotPage')
    expect(vi.mocked(CopilotPage).mock.lastCall![0]).toEqual({ accountId: ACCOUNT.id })
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/pacientes/:id exige sessão profissional desbloqueada: %s', async (condicao) => {
    const router = await loadRouterAt('/pacientes/paciente-1')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('prontuario-page')).toBeNull()
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/pacientes exige sessão profissional desbloqueada: %s', async (condicao) => {
    const router = await loadRouterAt('/pacientes')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('pacientes-page')).toBeNull()
  })

  it('/pacientes recebe a chave e o token da conta profissional', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/pacientes')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('pacientes-page')
    const { PacientesPage } = await import('../../pages/pacientes/PacientesPage')
    expect(vi.mocked(PacientesPage).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken, kek })
  })

  it('/pacientes/:id abre o prontuário uma vez por paciente e entrega o agendamento pedido à pasta', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/')
    const { SessionProvider } = await import('../providers/SessionProvider')
    const { useSession } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(7))
    function Desbloquear() {
      const { iniciarSessao } = useSession()
      return <button onClick={() => iniciarSessao(ACCOUNT, kek)}>Desbloquear</button>
    }
    render(<I18nProvider i18n={i18n}><SessionProvider><Desbloquear /><RouterProvider router={router} /></SessionProvider></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }))
    await act(async () => { await router.navigate({ to: '/pacientes/$patientId', params: { patientId: 'paciente-1' }, search: { agendamento: 'agendamento-9' } }) })
    await screen.findByTestId('prontuario-page')
    const { ProntuarioPage } = await import('../../pages/prontuario/ProntuarioPage')
    const { ProntuarioProvider } = await import('../../features/prontuario/ProntuarioProvider')
    expect(vi.mocked(ProntuarioProvider).mock.lastCall![0]).toMatchObject({ baseUrl: 'http://build.example', kek, accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken, patientId: 'paciente-1' })
    expect(vi.mocked(ProntuarioPage).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken, patientId: 'paciente-1', agendamento: 'agendamento-9' })
    await act(async () => { await router.navigate({ to: '/pacientes/$patientId', params: { patientId: 'paciente-2' }, search: {} }) })
    await vi.waitFor(() => expect(vi.mocked(ProntuarioPage).mock.lastCall![0]).toMatchObject({ patientId: 'paciente-2', agendamento: undefined }))
    expect(vi.mocked(ProntuarioProvider).mock.lastCall![0]).toMatchObject({ patientId: 'paciente-2' })
  })

  it.each([['nota', 'nota'], ['insights', 'insights'], ['qualquer', 'insights'], [undefined, 'insights']])('/pacientes/:id/sessoes/:atendimentoId abre a aba %s como %s dentro do prontuário do paciente', async (pedida, esperada) => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt(`/pacientes/paciente-1/sessoes/atendimento-3${pedida === undefined ? '' : `?aba=${pedida}`}`)
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('atendimento-page')
    expect(screen.getByTestId('prontuario-provider')).toBeTruthy()
    const { AtendimentoPage } = await import('../../pages/atendimento/AtendimentoPage')
    expect(vi.mocked(AtendimentoPage).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken, kek,
      patientId: 'paciente-1', atendimentoId: 'atendimento-3', aba: esperada })
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/pacientes/:id/sessoes/:atendimentoId herda a guarda do prontuário: %s', async (condicao) => {
    const router = await loadRouterAt('/pacientes/paciente-1/sessoes/atendimento-3?aba=nota')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('atendimento-page')).toBeNull()
    expect(screen.queryByTestId('prontuario-provider')).toBeNull()
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/biblioteca exige sessão profissional desbloqueada: %s', async (condicao) => {
    const router = await loadRouterAt('/biblioteca')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('biblioteca-page')).toBeNull()
  })
  it('/biblioteca recebe chave e token reais da conta profissional', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/biblioteca')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('biblioteca-page')
    const { BibliotecaAccountPage } = await import('../../pages/biblioteca/BibliotecaAccountPage')
    expect(vi.mocked(BibliotecaAccountPage).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', kek, accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken })
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/settings/voice exige conta profissional desbloqueada: %s', async (condicao) => {
    const router = await loadRouterAt('/settings/voice')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('voice-settings')).toBeNull()
  })
  it('/settings/voice recebe chave e token da conta e volta ao consultório pela barra', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/settings/voice')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('voice-settings')
    const { VoiceSettings } = await import('../../features/voice-enrollment/VoiceSettings')
    expect(vi.mocked(VoiceSettings).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', kek, accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Navegação principal' })).getByRole('link', { name: 'Consultório' }))
    await screen.findByTestId('home-page')
  })

  it.each(['sem sessão', 'sem token'])('/settings/audit exige sessão com token: %s', async (condicao) => {
    const router = await loadRouterAt('/settings/audit')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT, accessToken: null }
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek: null, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.queryByTestId('audit-page')).toBeNull()
  })
  it('/settings/audit recebe token e conta da sessão', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/settings/audit')
    const { SessionContext } = await import('../../entities/account/session-context')
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek: null, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('audit-page')
    const { AuditPage } = await import('../../pages/settings/AuditPage')
    expect(vi.mocked(AuditPage).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken })
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('/espelho exige conta profissional desbloqueada: %s', async (condicao) => {
    const router = await loadRouterAt('/espelho')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('espelho-p6')).toBeNull()
  })
  it('/espelho recebe chave e token da conta profissional', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/espelho')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('espelho-p6')
    const { EspelhoP6 } = await import('../../features/partilha/EspelhoP6')
    expect(vi.mocked(EspelhoP6).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', kek, accountId: ACCOUNT.id, accessToken: ACCOUNT.accessToken })
  })

  it('/hoje monta PartilhaCheckIns quando a chave está desbloqueada', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/hoje')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: PATIENT_ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}>
      <RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('partilha-check-ins')
    const { PartilhaCheckIns } = await import('../../features/partilha/PartilhaCheckIns')
    expect(vi.mocked(PartilhaCheckIns).mock.lastCall![0]).toEqual({ baseUrl: 'http://build.example', kek, accountId: PATIENT_ACCOUNT.id, accessToken: PATIENT_ACCOUNT.accessToken })
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('resolves /auth/magic-link and passes the build-constant baseUrl through, with token from the query string (S18-17)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/auth/magic-link?token=tok-123', true)

    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://build.example')
    expect(props.token).toBe('tok-123')
  })

  it('/auth/magic-link wires onAuthenticated to iniciarSessao -- calling it records the session', async () => {
    const router = await loadRouterAt('/auth/magic-link?token=tok-123', true)
    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    act(() => {
      props.onAuthenticated?.(ACCOUNT, {} as CryptoKey)
    })

    expect(JSON.parse(window.sessionStorage.getItem('limmiar:account')!)).toEqual(JSON.parse(contaPersistidaJson(ACCOUNT)))
  })

  it('/auth/magic-link falls back to an empty token when absent from the query string', async () => {
    const router = await loadRouterAt('/auth/magic-link', true)

    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('')
    expect(props.token).toBe('')
  })

  it('/auth/magic-link ignores baseUrl from the query string with the E2E gate off (S18-13)', async () => {
    // O host da API é sempre constante de build (nenhuma neste ambiente de teste, logo '').
    // Um link com `?baseUrl=` de terceiros não redireciona a cerimónia WebAuthn.
    const router = await loadRouterAt('/auth/magic-link?baseUrl=https%3A%2F%2Fatacante.tld&token=tok-123')

    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('')
    expect(props.token).toBe('tok-123')
  })

  it('/auth/magic-link ignores baseUrl from the query string with the E2E gate ON too (S18-13/S18-17)', async () => {
    // A correção do S18-17 apaga o ramo que fazia o portão de e2e governar de onde vem o host da
    // API desta rota: mesmo com o portão ligado, `?baseUrl=` de terceiros continua ignorado.
    const router = await loadRouterAt('/auth/magic-link?baseUrl=https%3A%2F%2Fatacante.tld&token=tok-123', true)

    await renderRouter(router)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('')
    expect(props.token).toBe('tok-123')
  })

  it('/auth/screen (E2E-only) forwards baseUrl, derives a Professional initialRole, and its getGoogleIdToken always rejects', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional', true)

    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.initialRole).toBe('Professional')
    expect(props.getGoogleIdToken).toBeUndefined()
  })

  it('/auth/screen (E2E-only) wires onAuthenticated to iniciarSessao -- calling it records the session', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional', true)
    await renderRouter(router)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    act(() => {
      props.onAuthenticated?.(ACCOUNT, {} as CryptoKey)
    })

    expect(JSON.parse(window.sessionStorage.getItem('limmiar:account')!)).toEqual(JSON.parse(contaPersistidaJson(ACCOUNT)))
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

  it('recuperação usa o servidor do build, sem aceitar servidor pela URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://build.example')
    const router = await loadRouterAt('/recover?baseUrl=http%3A%2F%2Fapi.test')

    await renderRouter(router)
    await screen.findByTestId('recovery-screen')

    const { RecoveryScreen } = await import('../../features/recovery/RecoveryScreen')
    expect(vi.mocked(RecoveryScreen).mock.calls[0]![0].baseUrl).toBe('http://build.example')
  })

  it('recuperação adota a chave restaurada e abre o consultório', async () => {
    const router = await loadRouterAt('/recover')
    await renderRouter(router)
    await screen.findByTestId('recovery-screen')

    const { RecoveryScreen } = await import('../../features/recovery/RecoveryScreen')
    const props = vi.mocked(RecoveryScreen).mock.calls[0]![0]
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    const kek = await webcrypto.importKek(new Uint8Array(32).fill(7))
    act(() => { props.onRecovered?.(ACCOUNT, kek) })

    expect(JSON.parse(window.sessionStorage.getItem('limmiar:account')!)).toEqual(JSON.parse(contaPersistidaJson(ACCOUNT)))
    await screen.findByTestId('home-page')
  })

  it('configuração de recuperação recebe a conta e a chave da sessão atual', async () => {
    const router = await loadRouterAt('/settings/recovery')
    const { SessionContext } = await import('../../entities/account/session-context')
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(7))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}><RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await screen.findByTestId('recovery-phrase-setup')

    const { RecoveryPhraseSetup } = await import('../../features/recovery/RecoveryPhraseSetup')
    const props = vi.mocked(RecoveryPhraseSetup).mock.calls[0]![0]
    expect(props.baseUrl).toBe('')
    expect(props.accountId).toBe(ACCOUNT.id)
    expect(props.accessToken).toBe(ACCOUNT.accessToken)
    expect(props.email).toBe(ACCOUNT.email)
    expect(props.kek).toBe(kek)
    act(() => props.onDone())
    expect((await screen.findByRole('status')).textContent).toBe('Frase de recuperação salva.')
  })

  it.each(['sem sessão', 'paciente', 'sem token', 'chave bloqueada'])('configuração de recuperação exige sessão profissional desbloqueada: %s', async (condicao) => {
    const router = await loadRouterAt('/settings/recovery')
    const { SessionContext } = await import('../../entities/account/session-context')
    const sessao = condicao === 'sem sessão' ? null : { ...ACCOUNT,
      role: condicao === 'paciente' ? 'Patient' as const : 'Professional' as const,
      accessToken: condicao === 'sem token' ? null : ACCOUNT.accessToken }
    const kek = condicao === 'chave bloqueada' ? null : await webcrypto.importKek(new Uint8Array(32).fill(8))
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}><RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(condicao === 'paciente' ? '/hoje' : '/'))
    expect(screen.queryByTestId('recovery-phrase-setup')).toBeNull()
  })

  it('pareamento de origem usa a sessão e ignora chaves e servidor da URL', async () => {
    const router = await loadRouterAt('/devices/pair-primary?baseUrl=https://outro.invalid&accountId=outra&accessToken=falso&kek=falso')
    const { SessionContext } = await import('../../entities/account/session-context')
    const { deriveAccountKek } = await import('../../entities/account/account-keys')
    const key = await deriveAccountKek('senha-pareamento', ACCOUNT.email!)
    render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao: ACCOUNT, kek: key, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }}><RouterProvider router={router} /></SessionContext.Provider></I18nProvider>)
    fireEvent.change(await screen.findByLabelText('Senha atual'), { target: { value: 'senha-pareamento' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código de pareamento' }))
    const { PairPrimaryDevice } = await import('../../features/device-pairing-primary/PairPrimaryDevice')
    await screen.findByTestId('pair-primary-device')
    const props = vi.mocked(PairPrimaryDevice).mock.lastCall![0]
    expect(props.accountId).toBe(ACCOUNT.id)
    expect(props.accessToken).toBe(ACCOUNT.accessToken)
    expect(props.baseUrl).not.toBe('https://outro.invalid')
    const raw = await props.getKekForTransfer()
    expect(raw).toHaveLength(32)
    raw.fill(0)
  }, 15000)

  it('dispositivo novo adota somente uma chave não extraível na sessão autenticada', async () => {
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/devices/pair-new?baseUrl=https://outro.invalid')
    await renderRouter(router)
    fireEvent.change(await screen.findByLabelText('Código de pareamento'), { target: { value: 'codigo-do-outro-dispositivo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Usar código de pareamento' }))
    await screen.findByTestId('pair-new-device')
    const { PairNewDevice } = await import('../../features/device-pairing-new/PairNewDevice')
    const props = vi.mocked(PairNewDevice).mock.lastCall![0]
    expect(props.baseUrl).not.toBe('https://outro.invalid')
    await expect(props.decode!()).resolves.toBe('codigo-do-outro-dispositivo')
    await act(async () => { await props.onKekAdopted(new Uint8Array(32).fill(7)) })
    await screen.findByText('Prontuários desbloqueados neste dispositivo.')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Navegação principal' })).getByRole('link', { name: 'Consultório' }))
    await screen.findByTestId('home-page')
    const { HomePage } = await import('../../pages/home/HomePage')
    expect(vi.mocked(HomePage).mock.lastCall![0].chaveiro.kek.extractable).toBe(false)
    expect(window.sessionStorage.getItem('limmiar:account')).not.toContain('kek')
  })

  it('a câmera só é aberta após escolher escanear no dispositivo novo', async () => {
    seedStoredAccount(ACCOUNT)
    const router = await loadRouterAt('/devices/pair-new')
    await renderRouter(router)
    expect(screen.queryByTestId('pair-new-device')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Escanear código QR' }))
    await screen.findByTestId('pair-new-device')
    const { PairNewDevice } = await import('../../features/device-pairing-new/PairNewDevice')
    expect(vi.mocked(PairNewDevice).mock.lastCall![0].decode).toBeUndefined()
  })

  it.each(['/devices/pair-primary', '/devices/pair-new'])('pareamento sem autenticação volta ao acesso (%s)', async path => {
    const router = await loadRouterAt(path)
    await renderRouter(router)
    await screen.findByTestId('auth-screen')
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByTestId('pair-primary-device')).toBeNull()
    expect(screen.queryByTestId('pair-new-device')).toBeNull()
  })

  it('resolves /e2e/microfone (E2E-only): forwards a valid consentimento to abrirMicrofone and shows an alert on refusal', async () => {
    const { abrirMicrofone } = await import('../../entities/consentimento/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({ ok: false, motivo: 'consentimento-ausente' })

    const router = await loadRouterAt('/e2e/microfone?consentimento=revogado', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect(abrirMicrofone).toHaveBeenCalledWith('revogado')
    expect((await screen.findByRole('alert')).textContent).toContain('consentimento-ausente')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('/e2e/microfone falls back to "pendente" when consentimento is absent from the query string', async () => {
    const { abrirMicrofone } = await import('../../entities/consentimento/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({ ok: false, motivo: 'consentimento-ausente' })

    const router = await loadRouterAt('/e2e/microfone', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect(abrirMicrofone).toHaveBeenCalledWith('pendente')
    await screen.findByRole('alert')
  })

  it('/e2e/microfone falls back to "pendente" when consentimento is not one of the three known states', async () => {
    const { abrirMicrofone } = await import('../../entities/consentimento/microfone')
    vi.mocked(abrirMicrofone).mockResolvedValue({ ok: false, motivo: 'consentimento-ausente' })

    const router = await loadRouterAt('/e2e/microfone?consentimento=bogus', true)
    await renderRouter(router)

    fireEvent.click(await screen.findByRole('button', { name: 'Gravar' }))

    expect(abrirMicrofone).toHaveBeenCalledWith('pendente')
    await screen.findByRole('alert')
  })

  it('resolves /e2e/vinculo (E2E-only): forwards baseUrl, accountId, accessToken, kek, papel and patientId', async () => {
    const kekBase64 = encodeBase64(new Uint8Array(32).fill(7))
    const query = new URLSearchParams({
      baseUrl: 'http://api.test',
      accountId: 'conta-marta',
      accessToken: 'token-marta',
      kek: kekBase64,
      papel: 'Professional',
      patientId: 'paciente-ana',
    })

    const router = await loadRouterAt(`/e2e/vinculo?${query.toString()}`, true)
    await renderRouter(router)

    const scaffold = await screen.findByTestId('e2e-vinculo-scaffold')
    expect(scaffold.dataset.papel).toBe('Professional')
    expect(scaffold.dataset.patientId).toBe('paciente-ana')

    const { E2eVinculoScaffold } = await import('./E2eVinculoScaffold')
    expect(vi.mocked(E2eVinculoScaffold).mock.calls[0]![0]).toMatchObject({
      baseUrl: 'http://api.test',
      accountId: 'conta-marta',
      accessToken: 'token-marta',
      kek: kekBase64,
    })
  })

  it('resolves /e2e/partilha (E2E-only): forwards baseUrl, accountId, accessToken, kek, papel and agora', async () => {
    const kekBase64 = encodeBase64(new Uint8Array(32).fill(7))
    const query = new URLSearchParams({
      baseUrl: 'http://api.test',
      accountId: 'conta-ana',
      accessToken: 'token-ana',
      kek: kekBase64,
      papel: 'paciente',
      agora: '2026-01-15T10:00:00.000Z',
    })

    const router = await loadRouterAt(`/e2e/partilha?${query.toString()}`, true)
    await renderRouter(router)

    const scaffold = await screen.findByTestId('e2e-partilha-scaffold')
    expect(scaffold.dataset.papel).toBe('paciente')
    expect(scaffold.dataset.agora).toBe('2026-01-15T10:00:00.000Z')

    const { E2ePartilhaScaffold } = await import('./E2ePartilhaScaffold')
    expect(vi.mocked(E2ePartilhaScaffold).mock.calls[0]![0]).toMatchObject({
      baseUrl: 'http://api.test',
      accountId: 'conta-ana',
      accessToken: 'token-ana',
      kek: kekBase64,
    })
  })

  it('resolves /e2e/partilha with an empty agora when the search param is omitted', async () => {
    const kekBase64 = encodeBase64(new Uint8Array(32).fill(7))
    const query = new URLSearchParams({
      baseUrl: 'http://api.test',
      accountId: 'conta-marta',
      accessToken: 'token-marta',
      kek: kekBase64,
      papel: 'profissional',
    })

    const router = await loadRouterAt(`/e2e/partilha?${query.toString()}`, true)
    await renderRouter(router)

    const scaffold = await screen.findByTestId('e2e-partilha-scaffold')
    expect(scaffold.dataset.papel).toBe('profissional')
    expect(scaffold.dataset.agora).toBe('')
  })

  it('redirects a Patient session from "/" to "/hoje", never rendering HomePage', async () => {
    seedStoredAccount(PATIENT_ACCOUNT)
    const router = await loadRouterAt('/')

    await renderRouter(router)
    await screen.findByTestId('paciente-hoje-page')

    expect(screen.queryByTestId('home-page')).toBeNull()
    expect(router.state.location.pathname).toBe('/hoje')
  })

  it('/hoje renders ContactoEmergencia alongside PacienteHojePage, with accountId/kek from the session', async () => {
    seedStoredAccount(PATIENT_ACCOUNT)
    const router = await loadRouterAt('/hoje')

    await renderRouter(router)
    await screen.findByTestId('paciente-hoje-page')

    expect(screen.getByTestId('contacto-emergencia')).toBeTruthy()
    const { PacienteHojePage } = await import('../../pages/paciente-hoje/PacienteHojePage')
    const props = vi.mocked(PacienteHojePage).mock.calls[0]![0]
    expect(props.accountId).toBe(PATIENT_ACCOUNT.id)
    expect(props.kek).toBeNull()
  })

  it('monta o seletor de idioma em todo ecrã, depois do conteúdo (o CVV segue o 1.º Tab do paciente)', async () => {
    seedStoredAccount(PATIENT_ACCOUNT)
    const router = await loadRouterAt('/hoje')

    await renderRouter(router)
    await screen.findByTestId('paciente-hoje-page')

    const seletor = screen.getByRole('navigation', { name: 'Idioma' })
    const emergencia = screen.getByTestId('contacto-emergencia')
    expect(emergencia.compareDocumentPosition(seletor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('/hoje sem sessão redireciona para autenticação', async () => {
    const router = await loadRouterAt('/hoje')

    await renderRouter(router)
    await screen.findByTestId('auth-screen')
    expect(screen.queryByTestId('paciente-hoje-page')).toBeNull()
  })

  it('resolves /e2e/paciente-hoje (E2E-only) with ContactoEmergencia present and accountId/kek forwarded to PacienteHojePage', async () => {
    const kek = new Uint8Array(32).fill(9)
    const router = await loadRouterAt(
      `/e2e/paciente-hoje?accountId=acc-e2e&kek=${encodeURIComponent(encodeBase64(kek))}`,
      true,
    )

    await renderRouter(router)
    await screen.findByTestId('paciente-hoje-page')

    expect(screen.getByTestId('contacto-emergencia')).toBeTruthy()
    const { PacienteHojePage } = await import('../../pages/paciente-hoje/PacienteHojePage')
    const props = await vi.waitFor(() => {
      const call = vi.mocked(PacienteHojePage).mock.calls.at(-1)![0]
      if (call.kek === null) throw new Error('kek not imported yet')
      return call
    })
    expect(props.accountId).toBe('acc-e2e')
    expect(props.kek).not.toBeNull()
  })

  it('/e2e/microfone shows a status when abrirMicrofone succeeds', async () => {
    const { abrirMicrofone } = await import('../../entities/consentimento/microfone')
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
