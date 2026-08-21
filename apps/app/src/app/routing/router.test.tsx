import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { encodeBase64 } from '../../shared/lib/base64'

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

// Route construction (createRoute/createRouter/routeTree, including the env-gated E2E
// branch) runs once at module top level. Each test needs its own fresh evaluation of that
// top level -- both to pick up window.history's current URL as the router's initial match,
// and (via vi.stubEnv) to pick either branch of the VITE_ENABLE_E2E_TEST_ROUTES ternary --
// so every test resets the module registry and re-imports router.tsx (and whichever mocked
// screen module it wants to inspect) from scratch, same technique the pre-existing index-
// route test already used.
async function loadRouterAt(url: string, enableE2ERoutes = false) {
  window.history.pushState({}, '', url)
  if (enableE2ERoutes) {
    vi.stubEnv('VITE_ENABLE_E2E_TEST_ROUTES', 'true')
  }
  vi.resetModules()
  const { router } = await import('./router')
  return router
}

describe('router', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    window.history.pushState({}, '', '/')
    delete (window as unknown as Record<string, unknown>).__e2eDecodeQr
    delete (window as unknown as Record<string, unknown>).__e2eKekAdopted
  })

  it('does not register the E2E-only routes when VITE_ENABLE_E2E_TEST_ROUTES is unset', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional')

    render(<RouterProvider router={router} />)

    expect(screen.queryByTestId('auth-screen')).toBeNull()
    expect(router.state.matches.some((match) => match.routeId === '/auth/screen')).toBe(false)
  })

  it('resolves the index route ("/") and renders the app shell', async () => {
    const router = await loadRouterAt('/')

    render(<RouterProvider router={router} />)

    const shell = await screen.findByText('Limmiar')

    expect(shell.id).toBe('app-shell')
    expect(shell.textContent).toBe('Limmiar')

    const matches = router.state.matches
    expect(matches).toHaveLength(2)
    expect(matches[0]?.routeId).toBe('__root__')
    expect(matches[1]?.routeId).toBe('/')
    expect(matches[1]?.fullPath).toBe('/')
  })

  it('resolves /auth/magic-link and passes baseUrl/token through to MagicLinkCallback', async () => {
    const router = await loadRouterAt('/auth/magic-link?baseUrl=http%3A%2F%2Fapi.test&token=tok-123')

    render(<RouterProvider router={router} />)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.token).toBe('tok-123')
  })

  it('/auth/magic-link falls back to empty strings when baseUrl/token are absent from the query string', async () => {
    const router = await loadRouterAt('/auth/magic-link')

    render(<RouterProvider router={router} />)
    await screen.findByTestId('magic-link-callback')

    const { MagicLinkCallback } = await import('../../features/magic-link-auth/MagicLinkCallback')
    const props = vi.mocked(MagicLinkCallback).mock.calls[0]![0]
    expect(props.baseUrl).toBe('')
    expect(props.token).toBe('')
  })

  it('/auth/screen (E2E-only) forwards baseUrl, derives a Professional initialRole, and its getGoogleIdToken always rejects', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Professional', true)

    render(<RouterProvider router={router} />)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.baseUrl).toBe('http://api.test')
    expect(props.initialRole).toBe('Professional')
    await expect(props.getGoogleIdToken()).rejects.toThrow(
      '/auth/screen is E2E-only scaffolding for magic-link-login.spec.ts, which never clicks the Google button.',
    )
  })

  it('/auth/screen (E2E-only) derives a Patient initialRole', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=Patient', true)

    render(<RouterProvider router={router} />)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.initialRole).toBe('Patient')
  })

  it('/auth/screen (E2E-only) falls back to an undefined initialRole for any other role value', async () => {
    const router = await loadRouterAt('/auth/screen?baseUrl=http%3A%2F%2Fapi.test&role=bogus', true)

    render(<RouterProvider router={router} />)
    await screen.findByTestId('auth-screen')

    const { AuthScreen } = await import('../../widgets/auth-screen/AuthScreen')
    const props = vi.mocked(AuthScreen).mock.calls[0]![0]
    expect(props.initialRole).toBeUndefined()
  })

  it('resolves /auth/recover (E2E-only) and passes baseUrl through to RecoveryScreen', async () => {
    const router = await loadRouterAt('/auth/recover?baseUrl=http%3A%2F%2Fapi.test', true)

    render(<RouterProvider router={router} />)
    await screen.findByTestId('recovery-screen')

    const { RecoveryScreen } = await import('../../features/recovery/RecoveryScreen')
    expect(vi.mocked(RecoveryScreen).mock.calls[0]![0].baseUrl).toBe('http://api.test')
  })

  it('resolves /auth/recovery-phrase-setup (E2E-only), passes every search param through, and onDone is a no-op', async () => {
    const router = await loadRouterAt(
      '/auth/recovery-phrase-setup?baseUrl=http%3A%2F%2Fapi.test&accountId=acc-1&accessToken=tok-1&email=a%40b.com',
      true,
    )

    render(<RouterProvider router={router} />)
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

    render(<RouterProvider router={router} />)
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

    render(<RouterProvider router={router} />)
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

    render(<RouterProvider router={router} />)
    await screen.findByTestId('pair-new-device')

    const { PairNewDevice } = await import('../../features/device-pairing-new/PairNewDevice')
    const props = vi.mocked(PairNewDevice).mock.calls[0]![0]

    await expect(props.decode!()).resolves.toBe('decoded-text')
    expect(e2eDecodeQr).toHaveBeenCalledTimes(1)

    const kek = new Uint8Array([9, 9, 9])
    props.onKekAdopted(kek)
    expect(e2eKekAdopted).toHaveBeenCalledWith(encodeBase64(kek))
  })
})
