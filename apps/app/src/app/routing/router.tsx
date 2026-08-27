import { createRootRoute, createRoute, createRouter, Link, useNavigate } from '@tanstack/react-router'
import { Trans } from '@lingui/react/macro'
import { AuthPage } from '../../pages/auth/AuthPage'
import { MagicLinkCallbackPage } from '../../pages/magic-link-callback/MagicLinkCallbackPage'
import { RecoveryPage } from '../../pages/recovery/RecoveryPage'
import { RecoveryPhraseSetupPage } from '../../pages/recovery/RecoveryPhraseSetupPage'
import { PairPrimaryPage } from '../../pages/device-pairing/PairPrimaryPage'
import { PairNewPage } from '../../pages/device-pairing/PairNewPage'
import { CopilotKeyPage } from '../../pages/settings/CopilotKeyPage'

function readSearchString(search: Record<string, unknown>, key: string): string {
  const value = search[key]
  return typeof value === 'string' ? value : ''
}

// The root route's own component is deliberately left unset: TanStack Router's default
// root component already renders an <Outlet/> for whichever child route matched, which is
// exactly this app's current shell -- an explicit `component: () => <Outlet/>` here would
// be equivalent, not a behavior change, so it is left implicit.
const rootRoute = createRootRoute()

// ponytail: this <div id="app-shell"> is a navigation stub, not a real landing page --
// replace it together with the real landing page, not as a standalone cleanup.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div id="app-shell">
      Limmiar{' '}
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

// S02-04 slice 7 / S02-05 (E2E) -- PRAGMATIC, TICKET-SCOPED ROUTING DECISION, NOT PRODUCTION UI:
//
// AuthScreen/PairPrimaryDevice/PairNewDevice have no real navigation entry point yet (no real
// "landing page" or settings screen exists to reach them from -- building either is out of
// scope for the tickets that built these screens). The routes below are the smallest possible
// way for the E2E to reach each screen directly by URL: `accountId`/`accessToken`/`baseUrl`
// come straight off the query string (mirroring entities/session's sessionStorage-backed
// recorder -- this is the same kind of "no real navigation flow to reach a protected route
// through yet" shortcut, just via the URL instead of a signed-in session, since the E2E drives
// independent browser CONTEXTS that do not share sessionStorage with each other or with a
// `beforeEach` setup step), and pages/device-pairing/PairPrimaryPage's `getKekForTransfer`
// resolves a fixed/known KEK (also carried in the query string, base64) instead of a real
// Keychain unlock -- S02-04's E2E proves the PAIRING PROTOCOL, not login (S02-01/S02-05) or
// DEK/KEK unlock (S01/S03), both already covered by their own tests.
//
// FOLLOW-UP (flagged for whoever builds the real landing-page/settings-screen entry points):
// these routes should be replaced, not built on top of -- they exist only so Playwright can
// open each screen without a full login UI flow in front of it.

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

// Judgment call (S02-06, not spelled out by the ticket the way /auth/recover was): same
// "no real navigation entry point yet" situation as PairPrimaryDevice/PairNewDevice above --
// RecoveryPhraseSetup is only ever reached from inside a real Professional session (there is
// no settings screen to launch it from yet), so account-recovery.spec.ts needs a direct-by-URL
// way in too. `accountId`/`accessToken`/`email` come straight off the query string, same
// shortcut as PairPrimarySearch's `accessToken`/`kek`.
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

// All of these routes are E2E-only scaffolding (see the file-level doc comment above) and
// must not ship in the real production bundle: auth/screen mounts AuthScreen with no
// login-flow guard in front of it, pair-primary takes an accessToken + raw KEK straight off
// the query string, pair-new is unusable without a window hook the E2E installs, auth/recover
// mounts RecoveryScreen the same bare way auth/screen mounts AuthScreen, and
// auth/recovery-phrase-setup takes an accessToken straight off the query string the same way
// pair-primary does -- but "unusable in practice" isn't the same as "absent from the bundle",
// a route registered in the real tree is still shipped, crawlable, and linkable. Gating on
// `import.meta.env.DEV` would also exclude them from THIS E2E, since playwright.config.ts
// exercises a real `vite build` (not `vite dev`) to match production bundling as closely as
// possible -- so this is a dedicated build-time flag the E2E's build command sets
// (VITE_ENABLE_E2E_TEST_ROUTES=true) and no other build (including local `vite dev`) does.

// ponytail: `kek` is pinned to `null` and `accountId` to '' because no KeychainProvider is
// mounted anywhere in the app yet. Whoever opens this route today sees the locked screen with
// "Pular", and that's the correct behavior, not a bug. Whoever wires up the keychain connects
// both here, in this same diff -- the empty accountId is only harmless while kek stays null.
function CopilotSettingsRouteComponent() {
  const navigate = useNavigate()
  return <CopilotKeyPage accountId="" kek={null} onDone={() => navigate({ to: '/' })} />
}

const copilotSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/copilot',
  component: CopilotSettingsRouteComponent,
})

const routeTree =
  import.meta.env.VITE_ENABLE_E2E_TEST_ROUTES === 'true'
    ? rootRoute.addChildren([
        indexRoute,
        magicLinkCallbackRoute,
        copilotSettingsRoute,
        authScreenE2ERoute,
        pairPrimaryRoute,
        pairNewRoute,
        recoveryScreenE2ERoute,
        recoveryPhraseSetupE2ERoute,
      ])
    : rootRoute.addChildren([indexRoute, magicLinkCallbackRoute, copilotSettingsRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
