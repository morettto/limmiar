import { createRootRoute, createRoute, createRouter, Link } from '@tanstack/react-router'
import { Trans } from '@lingui/react/macro'
import { AuthPage } from '../../pages/auth/AuthPage'
import { MagicLinkCallbackPage } from '../../pages/magic-link-callback/MagicLinkCallbackPage'
import { RecoveryPage } from '../../pages/recovery/RecoveryPage'
import { RecoveryPhraseSetupPage } from '../../pages/recovery/RecoveryPhraseSetupPage'
import { PairPrimaryPage } from '../../pages/device-pairing/PairPrimaryPage'
import { PairNewPage } from '../../pages/device-pairing/PairNewPage'
import { CopilotKeyPage } from '../../pages/settings/CopilotKeyPage'
import { NotaPage } from '../../pages/notas/NotaPage'
import { parseEstadoConsentimento, type EstadoConsentimento } from '../../entities/consentimento/api'
import { E2eMicrofoneScaffold } from './E2eMicrofoneScaffold'

function readSearchString(search: Record<string, unknown>, key: string): string {
  const value = search[key]
  return typeof value === 'string' ? value : ''
}


// The root route's component is deliberately unset: TanStack Router's default root already
// renders an <Outlet/> for the matched child, which is exactly this app's shell, so an explicit
// one would be equivalent.

const rootRoute = createRootRoute()

// ponytail: this <div id="app-shell"> is a navigation stub, not a real landing page --
// replace it together with the real landing page, not as a standalone cleanup.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div id="app-shell">
      Limmiar
      <Link to="/settings/copilot">
        <Trans>Configurar copiloto de IA</Trans>
      </Link>
    </div>
  ),
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
  return <MagicLinkCallbackPage baseUrl={baseUrl} token={token} />
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
  return <AuthPage baseUrl={baseUrl} role={role} />
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
  return <RecoveryPage baseUrl={baseUrl} />
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


const copilotSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/copilot',
  component: CopilotKeyPage,
})

// Ticket S08-01, fatia 2/5: Tela P4.1 (fila de assinatura + editor SOAP). Monta com uma
// nota em memória -- ver o comentário no topo de pages/notas/NotaPage.tsx.
const notaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notas',
  component: NotaPage,
})

const routeTree =
  import.meta.env.VITE_ENABLE_E2E_TEST_ROUTES === 'true'
    ? rootRoute.addChildren([
        indexRoute,
        magicLinkCallbackRoute,
        copilotSettingsRoute,
        notaRoute,
        authScreenE2ERoute,
        pairPrimaryRoute,
        pairNewRoute,
        recoveryScreenE2ERoute,
        recoveryPhraseSetupE2ERoute,
        e2eMicrofoneRoute,
      ])
    : rootRoute.addChildren([indexRoute, magicLinkCallbackRoute, copilotSettingsRoute, notaRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
