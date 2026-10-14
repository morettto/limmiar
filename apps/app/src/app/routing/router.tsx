import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from '@tanstack/react-router'
import { AuthPage } from '../../pages/auth/AuthPage'
import { HomePage } from '../../pages/home/HomePage'
import { PacienteHojePage } from '../../pages/paciente-hoje/PacienteHojePage'
import { AppShell } from '../../widgets/app-shell/AppShell'
import { ContactoEmergencia } from '../../widgets/contacto-emergencia/ContactoEmergencia'
import { E2ePacienteHojeScaffold } from './E2ePacienteHojeScaffold'
import { MagicLinkCallback } from '../../features/magic-link-auth/MagicLinkCallback'
import { RecoveryScreen } from '../../features/recovery/RecoveryScreen'
import { RecoveryPhraseSetupPage } from '../../pages/recovery/RecoveryPhraseSetupPage'
import { PairPrimaryPage } from '../../pages/device-pairing/PairPrimaryPage'
import { PairNewPage } from '../../pages/device-pairing/PairNewPage'
import { CopilotPage } from '../../pages/settings/CopilotPage'
import { VoicePage } from '../../pages/settings/VoicePage'
import { AuditPage } from '../../pages/settings/AuditPage'
import { PartilhaCheckIns } from '../../features/partilha/PartilhaCheckIns'
import { EspelhoP6 } from '../../features/partilha/EspelhoP6'
import { PacientesPage } from '../../pages/pacientes/PacientesPage'
import { ProntuarioPage } from '../../pages/prontuario/ProntuarioPage'
import { AtendimentoPage } from '../../pages/atendimento/AtendimentoPage'
import { ABA_INSIGHTS, ABA_NOTA, type AbaDoAtendimento } from '../../entities/atendimento/atendimento'
import { ProntuarioProvider } from '../../features/prontuario/ProntuarioProvider'
import { BibliotecaAccountPage } from '../../pages/biblioteca/BibliotecaAccountPage'
import { AcervoPage } from '../../pages/acervo/AcervoPage'
import { parseEstadoConsentimento, type EstadoConsentimento } from '../../entities/consentimento/api'
import { useSession } from '../../entities/account/session-context'
import { Trans } from '@lingui/react/macro'
import { E2eMicrofoneScaffold } from './E2eMicrofoneScaffold'
import { E2eVinculoScaffold } from './E2eVinculoScaffold'
import { E2ePartilhaScaffold } from './E2ePartilhaScaffold'
import { OnlineSessionPage } from '../../pages/online-session/OnlineSessionPage'

function readSearchString(search: Record<string, unknown>, key: string): string {
  const value = search[key]
  return typeof value === 'string' ? value : ''
}

const E2E_ROUTES_LIGADAS = import.meta.env.VITE_ENABLE_E2E_TEST_ROUTES === 'true'

// O host da API de /auth/magic-link é sempre constante de build (S18-17, ver README), em todos os
// builds, incluindo e2e (playwright.config.ts passa VITE_API_BASE_URL): nenhum `?baseUrl=` de
// terceiros num link de magic link chega a escolher o servidor.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const onlineSessionRoute = createRoute({ getParentRoute: () => rootRoute, path: '/session/online',
  component: () => <OnlineSessionPage baseUrl={API_BASE_URL} /> })

const rootRoute = createRootRoute({ component: () => <AppShell><Outlet /></AppShell> })

const acervoRoute = createRoute({ getParentRoute: () => rootRoute, path: '/acervo', component: AcervoRouteComponent })
function AcervoRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Professional' || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <AcervoPage baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} />
}

function IndexRouteComponent() {
  const { sessao, kek, iniciarSessao } = useSession()
  if (sessao === null || sessao.accessToken === null || (sessao.role === 'Professional' && kek === null)) {
    return <AuthPage baseUrl={API_BASE_URL} role="Professional" onAuthenticated={iniciarSessao} pairingAvailable={sessao?.role === 'Professional' && sessao.accessToken !== null} />
  }
  // S11-01: o role já chega em produção (validado em entities/account/session.ts), redirect real.
  if (sessao.role === 'Patient') {
    return <Navigate to="/hoje" />
  }
  return <HomePage baseUrl={API_BASE_URL} chaveiro={{ kek: kek!, accountId: sessao.id, accessToken: sessao.accessToken }} />
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRouteComponent,
})

interface MagicLinkCallbackSearch {
  token: string
}

const magicLinkCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/magic-link',
  validateSearch: (search: Record<string, unknown>): MagicLinkCallbackSearch => ({
    token: readSearchString(search, 'token'),
  }),
  component: MagicLinkCallbackRouteComponent,
})

function MagicLinkCallbackRouteComponent() {
  const { token } = magicLinkCallbackRoute.useSearch()
  const { iniciarSessao } = useSession()
  return <main className="settings-page">
    <header><h1>Limmiar</h1></header>
    <MagicLinkCallback key={token} baseUrl={API_BASE_URL} token={token} onAuthenticated={iniciarSessao} />
  </main>
}

// /auth/screen é andaime exclusivo de E2E; as rotas de pareamento abaixo são de produção.

interface AuthScreenE2ESearch {
  baseUrl: string
  // '' means unset -- AuthScreen falls back to its own default.
  role: string
}

const authScreenE2ERoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/screen',
  validateSearch: (search: Record<string, unknown>): AuthScreenE2ESearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
    role: readSearchString(search, 'role'),
  }),
  component: AuthScreenE2ERouteComponent,
})

function AuthScreenE2ERouteComponent() {
  const { baseUrl, role } = authScreenE2ERoute.useSearch()
  const { iniciarSessao } = useSession()
  return <AuthPage baseUrl={baseUrl} role={role} onAuthenticated={iniciarSessao} />
}

const recoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recover',
  component: RecoveryRouteComponent,
})

function RecoveryRouteComponent() {
  const { sessao, kek, iniciarSessao } = useSession()
  if (sessao?.accessToken && kek) return <Navigate to="/" />
  return <main className="settings-page">
    <header><h1><Trans>Recuperar acesso à conta</Trans></h1></header>
    <RecoveryScreen baseUrl={API_BASE_URL} onRecovered={iniciarSessao} />
  </main>
}

const recoverySetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/recovery',
  component: RecoverySetupRouteComponent,
})

function RecoverySetupRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Professional' || sessao.email === null || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <RecoveryPhraseSetupPage baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} email={sessao.email} kek={kek} />
}

const pairPrimaryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/devices/pair-primary',
  component: PairPrimaryRouteComponent,
})

function PairPrimaryRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao?.role !== 'Professional' || !sessao.accessToken || sessao.email === null || kek === null) return <Navigate to="/" />
  return <PairPrimaryPage baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} email={sessao.email} kek={kek} />
}

const pairNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/devices/pair-new',
  component: PairNewRouteComponent,
})

function PairNewRouteComponent() {
  const { sessao, iniciarSessao } = useSession()
  if (sessao?.role !== 'Professional' || !sessao.accessToken) return <Navigate to="/" />
  return <PairNewPage baseUrl={API_BASE_URL} onUnlocked={key => iniciarSessao(sessao, key)} />
}

// S10-02 fatia 6: andaime de E2E sem equivalente de producao -- o consentimento chega por query
// string para consentimento-microfone.spec.ts clicar "Gravar" com um estado conhecido e ler no
// DOM o que `abrirMicrofone` devolveu, sem inventar UI real.
interface E2eMicrofoneSearch {
  consentimento: EstadoConsentimento
}

const e2eMicrofoneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/e2e/microfone',
  validateSearch: (search: Record<string, unknown>): E2eMicrofoneSearch => ({
    consentimento: parseEstadoConsentimento(search.consentimento),
  }),
  component: E2eMicrofoneRouteComponent,
})

function E2eMicrofoneRouteComponent() {
  const { consentimento } = e2eMicrofoneRoute.useSearch()
  return <E2eMicrofoneScaffold consentimento={consentimento} />
}

// S11-04 fatia 5: sem KeychainProvider ainda (mesmo motivo de e2ePacienteHojeRoute) -- o cenário
// E2E semeia conta, token e KEK pela query string para alcançar os ecrãs de vínculo.
interface E2eVinculoSearch {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: string
  papel: string
  patientId: string
}

const e2eVinculoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/e2e/vinculo',
  validateSearch: (search: Record<string, unknown>): E2eVinculoSearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
    accountId: readSearchString(search, 'accountId'),
    accessToken: readSearchString(search, 'accessToken'),
    kek: readSearchString(search, 'kek'),
    papel: readSearchString(search, 'papel'),
    patientId: readSearchString(search, 'patientId'),
  }),
  component: E2eVinculoRouteComponent,
})

function E2eVinculoRouteComponent() {
  const { baseUrl, accountId, accessToken, kek, papel, patientId } = e2eVinculoRoute.useSearch()
  return (
    <E2eVinculoScaffold
      baseUrl={baseUrl}
      accountId={accountId}
      accessToken={accessToken}
      kek={kek}
      papel={papel}
      patientId={patientId}
    />
  )
}

// S11-02 fatia 6: mesma situação de e2eVinculoRoute -- sem KeychainProvider ainda, o cenário
// E2E semeia conta, token, KEK e o "agora" dos dois lados pela query string.
interface E2ePartilhaSearch {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: string
  papel: string
  agora: string
}

const e2ePartilhaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/e2e/partilha',
  validateSearch: (search: Record<string, unknown>): E2ePartilhaSearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
    accountId: readSearchString(search, 'accountId'),
    accessToken: readSearchString(search, 'accessToken'),
    kek: readSearchString(search, 'kek'),
    papel: readSearchString(search, 'papel'),
    agora: readSearchString(search, 'agora'),
  }),
  component: E2ePartilhaRouteComponent,
})

function E2ePartilhaRouteComponent() {
  const { baseUrl, accountId, accessToken, kek, papel, agora } = e2ePartilhaRoute.useSearch()
  return (
    <E2ePartilhaScaffold
      baseUrl={baseUrl}
      accountId={accountId}
      accessToken={accessToken}
      kek={kek}
      papel={papel}
      agora={agora}
    />
  )
}

// These routes are E2E-only scaffolding and must not ship: each mounts a screen with no guard or
// reads an accessToken/raw KEK off the query string, and a registered route is shipped and
// linkable even when unusable.

// VITE_ENABLE_E2E_TEST_ROUTES gates them at build time; `import.meta.env.DEV` would not, since
// playwright.config.ts exercises a real `vite build`, not `vite dev`.


function CopilotRouteComponent() {
  const { sessao } = useSession()
  if (sessao === null || sessao.role !== 'Professional') return <Navigate to="/" />
  return <CopilotPage accountId={sessao.id} />
}

const copilotSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/copilot', component: CopilotRouteComponent })

function VoiceRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Professional' || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <VoicePage baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} />
}

const voiceSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/voice', component: VoiceRouteComponent })

function AuditRouteComponent() {
  const { sessao } = useSession()
  if (sessao === null || sessao.accessToken === null) return <Navigate to="/" />
  return <AuditPage baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} />
}

const auditSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/audit', component: AuditRouteComponent })

function EspelhoRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Professional' || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <main className="settings-page">
    <header><h1><Trans>Sinais compartilhados pelos pacientes</Trans></h1></header>
    <EspelhoP6 baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} />
  </main>
}

const espelhoRoute = createRoute({ getParentRoute: () => rootRoute, path: '/espelho', component: EspelhoRouteComponent })

function PacientesRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Professional' || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <PacientesPage key={sessao.id} baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} />
}

const pacientesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pacientes', component: PacientesRouteComponent })

function ProntuarioLayoutComponent() {
  const { sessao, kek } = useSession()
  const { patientId } = prontuarioRoute.useParams()
  if (sessao === null || sessao.role !== 'Professional' || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <ProntuarioProvider key={patientId} baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} patientId={patientId}>
    <Outlet />
  </ProntuarioProvider>
}

// Fora do layout `paciente` (abaixo): é a pasta do profissional, não um ecrã do papel Patient.
const prontuarioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pacientes/$patientId',
  component: ProntuarioLayoutComponent,
})

interface ProntuarioSearch {
  agendamento?: string
}

const prontuarioIndexRoute = createRoute({
  getParentRoute: () => prontuarioRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): ProntuarioSearch => ({
    agendamento: readSearchString(search, 'agendamento') || undefined,
  }),
  component: ProntuarioRouteComponent,
})

function ProntuarioRouteComponent() {
  const { sessao } = useSession()
  const { patientId } = prontuarioIndexRoute.useParams()
  const { agendamento } = prontuarioIndexRoute.useSearch()
  return <ProntuarioPage baseUrl={API_BASE_URL} accountId={sessao!.id} accessToken={sessao!.accessToken!} patientId={patientId} agendamento={agendamento} />
}

interface AtendimentoSearch {
  aba: AbaDoAtendimento
}

const atendimentoRoute = createRoute({
  getParentRoute: () => prontuarioRoute,
  path: 'sessoes/$atendimentoId',
  validateSearch: (search: Record<string, unknown>): AtendimentoSearch => ({
    aba: search.aba === ABA_NOTA ? ABA_NOTA : ABA_INSIGHTS,
  }),
  component: AtendimentoRouteComponent,
})

function AtendimentoRouteComponent() {
  const { sessao, kek } = useSession()
  const { patientId, atendimentoId } = atendimentoRoute.useParams()
  const { aba } = atendimentoRoute.useSearch()
  return <AtendimentoPage baseUrl={API_BASE_URL} accountId={sessao!.id} accessToken={sessao!.accessToken!} kek={kek!} patientId={patientId} atendimentoId={atendimentoId} aba={aba} />
}

function BibliotecaRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Professional' || sessao.accessToken === null || kek === null) return <Navigate to="/" />
  return <BibliotecaAccountPage key={sessao.id} baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} />
}

// Ticket S08-02, fatias 4-5: biblioteca de notas com busca cifrada no cliente. Rota normal
// de produto (não vai atrás do gate VITE_ENABLE_E2E_TEST_ROUTES) -- ao contrário dos blocos
// acima, esta não é scaffolding só para o E2E alcançar a tela.
const bibliotecaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/biblioteca',
  component: BibliotecaRouteComponent,
})

// S11-01: layout pathless (`id`, sem `path`) -- ContactoEmergencia fica montado em TODO ecrã de
// paciente por ser irmão do `<Outlet/>`, não por repeti-lo em cada página (invariante do ticket:
// caminho de emergência em todos os ecrãs). Ecrã de paciente futuro entra como filho daqui.
const pacienteLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'paciente',
  component: PacienteLayoutComponent,
})

function PacienteLayoutComponent() {
  return (
    <main>
      <ContactoEmergencia />
      <Outlet />
    </main>
  )
}

function PacienteHojeRouteComponent() {
  const { sessao, kek } = useSession()
  if (sessao === null || sessao.role !== 'Patient' || sessao.accessToken === null) return <Navigate to="/" />
  return <>
    <PacienteHojePage accountId={sessao.id} kek={kek} partilha={{ baseUrl: API_BASE_URL, accessToken: sessao.accessToken }} />
    {kek && <PartilhaCheckIns baseUrl={API_BASE_URL} accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} />}
  </>
}

const pacienteHojeRoute = createRoute({
  getParentRoute: () => pacienteLayoutRoute,
  path: '/hoje',
  component: PacienteHojeRouteComponent,
})

interface E2ePacienteHojeSearch {
  accountId: string
  // Base64 de uma KEK de teste de 32 bytes -- mesmo precedente de pairPrimaryRoute.
  kek: string
}

const e2ePacienteHojeRoute = createRoute({
  getParentRoute: () => pacienteLayoutRoute,
  path: '/e2e/paciente-hoje',
  validateSearch: (search: Record<string, unknown>): E2ePacienteHojeSearch => ({
    accountId: readSearchString(search, 'accountId'),
    kek: readSearchString(search, 'kek'),
  }),
  component: E2ePacienteHojeRouteComponent,
})

function E2ePacienteHojeRouteComponent() {
  const { accountId, kek } = e2ePacienteHojeRoute.useSearch()
  return <E2ePacienteHojeScaffold accountId={accountId} kek={kek} />
}

const pacienteLayoutWithChildren = pacienteLayoutRoute.addChildren([
  pacienteHojeRoute,
  ...(E2E_ROUTES_LIGADAS ? [e2ePacienteHojeRoute] : []),
])

const routeTree =
  rootRoute.addChildren([
        indexRoute,
        magicLinkCallbackRoute,
        onlineSessionRoute,
        copilotSettingsRoute,
        voiceSettingsRoute,
        auditSettingsRoute,
        espelhoRoute,
        recoveryRoute,
        recoverySetupRoute,
        pacientesRoute,
        prontuarioRoute.addChildren([prontuarioIndexRoute, atendimentoRoute]),
        bibliotecaRoute,
        acervoRoute,
        pairPrimaryRoute,
        pairNewRoute,
        pacienteLayoutWithChildren,
        ...(E2E_ROUTES_LIGADAS ? [authScreenE2ERoute, e2eMicrofoneRoute, e2eVinculoRoute, e2ePartilhaRoute] : []),
      ])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
