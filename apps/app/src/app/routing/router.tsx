import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AuthPage } from '../../pages/auth/AuthPage'
import { HomePage } from '../../pages/home/HomePage'
import { MagicLinkCallback } from '../../features/magic-link-auth/MagicLinkCallback'
import { RecoveryScreen } from '../../features/recovery/RecoveryScreen'
import { RecoveryPhraseSetupPage } from '../../pages/recovery/RecoveryPhraseSetupPage'
import { PairPrimaryPage } from '../../pages/device-pairing/PairPrimaryPage'
import { PairNewPage } from '../../pages/device-pairing/PairNewPage'
import { CopilotKeyPage } from '../../pages/settings/CopilotKeyPage'
import { NotaPage } from '../../pages/notas/NotaPage'
import { BibliotecaPage } from '../../pages/biblioteca/BibliotecaPage'
import { parseEstadoConsentimento, type EstadoConsentimento } from '../../entities/consentimento/api'
import { useSession } from '../providers/SessionProvider'
import { E2eMicrofoneScaffold } from './E2eMicrofoneScaffold'

function readSearchString(search: Record<string, unknown>, key: string): string {
  const value = search[key]
  return typeof value === 'string' ? value : ''
}


// The root route's component is deliberately unset: TanStack Router's default root already
// renders an <Outlet/> for the matched child, which is exactly this app's shell, so an explicit
// one would be equivalent.

const rootRoute = createRootRoute()

function IndexRouteComponent() {
  const { sessao, terminarSessao } = useSession()
  return <HomePage email={sessao?.email ?? null} onSair={terminarSessao} />
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexRouteComponent,
})

interface MagicLinkCallbackSearch {
  baseUrl: string
  token: string
}

const magicLinkCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/magic-link',
  validateSearch: (search: Record<string, unknown>): MagicLinkCallbackSearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
    token: readSearchString(search, 'token'),
  }),
  component: MagicLinkCallbackRouteComponent,
})

function MagicLinkCallbackRouteComponent() {
  const { baseUrl, token } = magicLinkCallbackRoute.useSearch()
  const { iniciarSessao } = useSession()
  return <MagicLinkCallback baseUrl={baseUrl} token={token} onAuthenticated={iniciarSessao} />
}

// S02-04 fatia 7 / S02-05 — E2E scaffolding, not production UI: these screens have no navigation
// entry point yet, so the routes below let Playwright reach each one by URL, with the ids, tokens
// and a fixed KEK off the query string. Replace them once the real entry points exist.

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

interface RecoveryScreenE2ESearch {
  baseUrl: string
}

const recoveryScreenE2ERoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/recover',
  validateSearch: (search: Record<string, unknown>): RecoveryScreenE2ESearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
  }),
  component: RecoveryScreenE2ERouteComponent,
})

function RecoveryScreenE2ERouteComponent() {
  const { baseUrl } = recoveryScreenE2ERoute.useSearch()
  const { iniciarSessao } = useSession()
  return <RecoveryScreen baseUrl={baseUrl} onRecovered={iniciarSessao} />
}

// Judgment call (S02-06): same "no navigation entry point yet" situation as the pairing routes
// above — RecoveryPhraseSetup is only reached from inside a real Professional session, so
// account-recovery.spec.ts needs a direct-by-URL way in, with the same query-string shortcut.
interface RecoveryPhraseSetupE2ESearch {
  baseUrl: string
  accountId: string
  accessToken: string
  email: string
}

const recoveryPhraseSetupE2ERoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/recovery-phrase-setup',
  validateSearch: (search: Record<string, unknown>): RecoveryPhraseSetupE2ESearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
    accountId: readSearchString(search, 'accountId'),
    accessToken: readSearchString(search, 'accessToken'),
    email: readSearchString(search, 'email'),
  }),
  component: RecoveryPhraseSetupE2ERouteComponent,
})

function RecoveryPhraseSetupE2ERouteComponent() {
  const { baseUrl, accountId, accessToken, email } = recoveryPhraseSetupE2ERoute.useSearch()
  return <RecoveryPhraseSetupPage baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} email={email} />
}

interface PairPrimarySearch {
  baseUrl: string
  accountId: string
  accessToken: string
  // Base64 of a fixed 32-byte test KEK -- see the file-level doc comment above.
  kek: string
}

const pairPrimaryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/devices/pair-primary',
  validateSearch: (search: Record<string, unknown>): PairPrimarySearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
    accountId: readSearchString(search, 'accountId'),
    accessToken: readSearchString(search, 'accessToken'),
    kek: readSearchString(search, 'kek'),
  }),
  component: PairPrimaryRouteComponent,
})

function PairPrimaryRouteComponent() {
  const { baseUrl, accountId, accessToken, kek } = pairPrimaryRoute.useSearch()
  return <PairPrimaryPage baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} kek={kek} />
}

interface PairNewSearch {
  baseUrl: string
}

const pairNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/devices/pair-new',
  validateSearch: (search: Record<string, unknown>): PairNewSearch => ({
    baseUrl: readSearchString(search, 'baseUrl'),
  }),
  component: PairNewRouteComponent,
})

function PairNewRouteComponent() {
  const { baseUrl } = pairNewRoute.useSearch()
  return <PairNewPage baseUrl={baseUrl} />
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

// These routes are E2E-only scaffolding and must not ship: each mounts a screen with no guard or
// reads an accessToken/raw KEK off the query string, and a registered route is shipped and
// linkable even when unusable.

// VITE_ENABLE_E2E_TEST_ROUTES gates them at build time; `import.meta.env.DEV` would not, since
// playwright.config.ts exercises a real `vite build`, not `vite dev`.


// useSession() only works under app/routing (fsd-pages-no-app forbids pages from importing app),
// so this thin wrapper is the one place that can read `sessao` and hand CopilotKeyPage a real
// accountId -- reintroduced after S07-04 follow-up B3 removed it, for that reason.
function CopilotKeyRouteComponent() {
  const { sessao } = useSession()
  return <CopilotKeyPage accountId={sessao?.id ?? null} />
}

const copilotSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/copilot',
  component: CopilotKeyRouteComponent,
})

// ponytail: mesma situação, mesmo motivo do `dek={null}` de BibliotecaRouteComponent --
// sem KeychainProvider/sessão real montada ainda. Quem ligar Keychain/sessão substitui
// `kek={null}` por uma `CryptoKey` real -- a lógica de NotaPage não muda.
function NotaRouteComponent() {
  return <NotaPage kek={null} />
}

// Ticket S08-01, fatia 2/5: Tela P4.1 (fila de assinatura + editor SOAP). Monta com uma
// nota em memória -- ver o comentário no topo de pages/notas/NotaPage.tsx.
const notaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notas',
  component: NotaRouteComponent,
})

// ponytail: mesma situação do `kek={null}` de CopilotKeyPage/NotaPage -- sem KeychainProvider
// ainda. `chaveIndice={null}` deixa BibliotecaPage em `a-preparar` sem abrir OPFS. `accountId` já
// vem da sessão real (S18-01); só falta o chaveiro, fora de âmbito desta spec.
const BIBLIOTECA_STORE_FIXTURE = { ler: async () => null, gravar: async () => {}, apagar: async () => {} }

function BibliotecaRouteComponent() {
  const { sessao } = useSession()
  return <BibliotecaPage notas={[]} accountId={sessao?.id ?? null} chaveIndice={null} store={BIBLIOTECA_STORE_FIXTURE} />
}

// Ticket S08-02, fatias 4-5: biblioteca de notas com busca cifrada no cliente. Rota normal
// de produto (não vai atrás do gate VITE_ENABLE_E2E_TEST_ROUTES) -- ao contrário dos blocos
// acima, esta não é scaffolding só para o E2E alcançar a tela.
const bibliotecaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/biblioteca',
  component: BibliotecaRouteComponent,
})

const routeTree =
  import.meta.env.VITE_ENABLE_E2E_TEST_ROUTES === 'true'
    ? rootRoute.addChildren([
        indexRoute,
        magicLinkCallbackRoute,
        copilotSettingsRoute,
        notaRoute,
        bibliotecaRoute,
        authScreenE2ERoute,
        pairPrimaryRoute,
        pairNewRoute,
        recoveryScreenE2ERoute,
        recoveryPhraseSetupE2ERoute,
        e2eMicrofoneRoute,
      ])
    : rootRoute.addChildren([indexRoute, magicLinkCallbackRoute, copilotSettingsRoute, notaRoute, bibliotecaRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
