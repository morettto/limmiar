import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import { PairingQr } from './PairingQr'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    createPairingSession: vi.fn(),
    getPairingClaimStatus: vi.fn(),
  }
})

const createPairingSessionMock = vi.mocked(client.createPairingSession)
const getPairingClaimStatusMock = vi.mocked(client.getPairingClaimStatus)

const ACCOUNT_ID = '33333333-3333-3333-3333-333333333333'
const ACCESS_TOKEN = 'access-token-xyz'
const PRIMARY_PUBLIC_KEY = 'cHJpbWFyeS1wdWJsaWMta2V5'
const NEW_DEVICE_PUBLIC_KEY = 'bmV3LWRldmljZS1wdWJsaWMta2V5'
const SESSION_ID = 'session-abc'

// The mount effect chains two `await`s (createPairingSession, then QRCode.toDataURL)
// before it calls setState -- and QRCode's Node renderer schedules its own work via
// setImmediate, which vi.useFakeTimers() fakes by default same as setTimeout/setInterval.
// A single `vi.advanceTimersByTimeAsync(0)` only flushes ONE step of that chain (whatever
// is already due), so a promise-then-setImmediate-then-promise chain needs repeated calls,
// each one both firing whatever fake timer/immediate is now due AND draining the
// microtasks that scheduling produces, until the chain bottoms out at setState.
async function flushMicrotasks() {
  for (let i = 0; i < 50; i++) {
    await vi.advanceTimersByTimeAsync(0)
  }
}

function renderPairingQr(onClaimed: (key: string, sessionId: string) => void = vi.fn(), onExpired?: () => void) {
  return render(
    <I18nProvider i18n={i18n}>
      <PairingQr
        baseUrl="http://api.test"
        accountId={ACCOUNT_ID}
        accessToken={ACCESS_TOKEN}
        primaryPublicKeyBase64={PRIMARY_PUBLIC_KEY}
        onClaimed={onClaimed}
        onExpired={onExpired}
      />
    </I18nProvider>,
  )
}

describe('PairingQr', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('renders a loading state on mount and calls createPairingSession with the right args', async () => {
    let resolveCreate: (result: client.CreatePairingSessionResult) => void = () => {}
    createPairingSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderPairingQr()

    expect(screen.getByRole('status').textContent).toBe('Preparando o código para parear o novo dispositivo...')
    await waitFor(() =>
      expect(createPairingSessionMock).toHaveBeenCalledWith(
        'http://api.test',
        ACCOUNT_ID,
        ACCESS_TOKEN,
        PRIMARY_PUBLIC_KEY,
      ),
    )

    // Resolve so the pending promise doesn't leak a dangling state update into the next test.
    resolveCreate({ ok: true, sessionId: SESSION_ID, expiresAt: new Date(Date.now() + 60_000).toISOString() })
    await screen.findByRole('img')
  })

  it('renders the QR code once the session is created', async () => {
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValue({ ok: true, claimed: false, newDevicePublicKey: null })
    renderPairingQr()

    const img = await screen.findByRole('img')
    expect((img as HTMLImageElement).src.startsWith('data:image')).toBe(true)
  })

  it('polls getPairingClaimStatus every second while displaying the QR', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(now + 60_000).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValue({ ok: true, claimed: false, newDevicePublicKey: null })
    renderPairingQr()

    // findByRole's own retry loop uses a real setTimeout, which never fires under fake
    // timers -- flush the mount effect's promise chain (createPairingSession -> toDataURL)
    // with the fake-timer-aware advance instead, then read the DOM synchronously.
    await flushMicrotasks()
    screen.getByRole('img')
    expect(getPairingClaimStatusMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(getPairingClaimStatusMock).toHaveBeenCalledTimes(1)
    expect(getPairingClaimStatusMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, SESSION_ID)

    await vi.advanceTimersByTimeAsync(1000)
    expect(getPairingClaimStatusMock).toHaveBeenCalledTimes(2)
  })

  it('calls onClaimed once claimed is detected and stops polling', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(now + 60_000).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValueOnce({ ok: true, claimed: false, newDevicePublicKey: null })
    getPairingClaimStatusMock.mockResolvedValueOnce({
      ok: true,
      claimed: true,
      newDevicePublicKey: NEW_DEVICE_PUBLIC_KEY,
    })
    const onClaimed = vi.fn()
    renderPairingQr(onClaimed)

    await flushMicrotasks()
    screen.getByRole('img')

    await vi.advanceTimersByTimeAsync(1000)
    expect(onClaimed).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onClaimed).toHaveBeenCalledWith(NEW_DEVICE_PUBLIC_KEY, SESSION_ID)

    const callsAfterClaim = getPairingClaimStatusMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(getPairingClaimStatusMock.mock.calls.length).toBe(callsAfterClaim)
  })

  it('calls onExpired and stops polling once expiresAt has passed', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(now + 1500).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValue({ ok: true, claimed: false, newDevicePublicKey: null })
    const onExpired = vi.fn()
    renderPairingQr(vi.fn(), onExpired)

    await flushMicrotasks()
    screen.getByRole('img')

    await vi.advanceTimersByTimeAsync(1000)
    expect(getPairingClaimStatusMock).toHaveBeenCalledTimes(1)
    expect(onExpired).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(getPairingClaimStatusMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toBe('Este código expirou. Volte para gerar um novo.')

    const callsAfterExpiry = getPairingClaimStatusMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(getPairingClaimStatusMock.mock.calls.length).toBe(callsAfterExpiry)
  })

  it('renders a translated error when createPairingSession fails', async () => {
    createPairingSessionMock.mockResolvedValue({ ok: false, code: 'auth.access_token_invalid', params: {} })
    renderPairingQr()

    expect((await screen.findByRole('alert')).textContent).toBe('Ocorreu um erro inesperado. Tente novamente.')
  })
})
