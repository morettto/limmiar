import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import QRCode from 'qrcode'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as deviceApi from '../../entities/device/api'
import { PairingQr } from './PairingQr'

vi.mock('../../entities/device/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/device/api')>('../../entities/device/api')
  return {
    ...actual,
    createPairingSession: vi.fn(),
    getPairingClaimStatus: vi.fn(),
  }
})

const createPairingSessionMock = vi.mocked(deviceApi.createPairingSession)
const getPairingClaimStatusMock = vi.mocked(deviceApi.getPairingClaimStatus)

const ACCOUNT_ID = '33333333-3333-3333-3333-333333333333'
const ACCESS_TOKEN = 'access-token-xyz'
const PRIMARY_PUBLIC_KEY = 'cHJpbWFyeS1wdWJsaWMta2V5'
const NEW_DEVICE_PUBLIC_KEY = 'bmV3LWRldmljZS1wdWJsaWMta2V5'
const SESSION_ID = 'session-abc'

// Under fake timers these tests must not depend on QRCode.toDataURL's real implementation: it
// schedules work via setImmediate, and how many hops that takes has shifted across Node versions and
// made the suite flaky. The mock resolves on the microtask queue only.
function mockToDataURLForFakeTimers() {
  return vi
    .spyOn(QRCode, 'toDataURL')
    .mockImplementation(
      () => Promise.resolve('data:image/png;base64,mock') as unknown as ReturnType<typeof QRCode.toDataURL>,
    )
}

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
    let resolveCreate: (result: deviceApi.CreatePairingSessionResult) => void = () => {}
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
    const toDataURLSpy = vi.spyOn(QRCode, 'toDataURL')
    renderPairingQr()

    const img = await screen.findByRole('img')
    expect((img as HTMLImageElement).src.startsWith('data:image')).toBe(true)
    expect(img.getAttribute('alt')).toBe('Código QR para parear novo dispositivo')
    expect(toDataURLSpy).toHaveBeenCalledWith(
      JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: 'http://api.test' }),
    )
    toDataURLSpy.mockRestore()
  })

  it('does not poll while still creating the session or after it errors', async () => {
    vi.useFakeTimers()
    createPairingSessionMock.mockResolvedValue({ ok: false, code: 'auth.access_token_invalid', params: {} })
    renderPairingQr()

    await flushMicrotasks()
    expect(screen.getByRole('alert')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(5000)
    expect(getPairingClaimStatusMock).not.toHaveBeenCalled()
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
    const toDataURLSpy = mockToDataURLForFakeTimers()
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
    toDataURLSpy.mockRestore()
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
    const toDataURLSpy = mockToDataURLForFakeTimers()
    renderPairingQr(onClaimed)

    await flushMicrotasks()
    screen.getByRole('img')

    await vi.advanceTimersByTimeAsync(1000)
    expect(onClaimed).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onClaimed).toHaveBeenCalledWith(NEW_DEVICE_PUBLIC_KEY, SESSION_ID)
    await flushMicrotasks()
    expect(screen.getByRole('status').textContent).toBe('Dispositivo pareado com sucesso.')

    const callsAfterClaim = getPairingClaimStatusMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(getPairingClaimStatusMock.mock.calls.length).toBe(callsAfterClaim)
    toDataURLSpy.mockRestore()
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
    const toDataURLSpy = mockToDataURLForFakeTimers()
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
    toDataURLSpy.mockRestore()
  })

  it('treats the exact expiry instant as expired', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(now + 1000).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValue({ ok: true, claimed: false, newDevicePublicKey: null })
    const onExpired = vi.fn()
    const toDataURLSpy = mockToDataURLForFakeTimers()
    renderPairingQr(vi.fn(), onExpired)

    await flushMicrotasks()
    screen.getByRole('img')

    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()
    expect(onExpired).toHaveBeenCalledTimes(1)
    toDataURLSpy.mockRestore()
  })

  it('does not throw when expiry fires without an onExpired callback', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(now + 1000).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValue({ ok: true, claimed: false, newDevicePublicKey: null })
    const toDataURLSpy = mockToDataURLForFakeTimers()
    renderPairingQr(vi.fn(), undefined)

    await flushMicrotasks()
    screen.getByRole('img')

    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()
    expect(screen.getByRole('alert').textContent).toBe('Este código expirou. Volte para gerar um novo.')
    toDataURLSpy.mockRestore()
  })

  it('never calls QRCode.toDataURL when unmounted before createPairingSession resolves', async () => {
    let resolveCreate: (result: deviceApi.CreatePairingSessionResult) => void = () => {}
    createPairingSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const toDataURLSpy = vi.spyOn(QRCode, 'toDataURL')

    const { unmount } = renderPairingQr()
    await waitFor(() => expect(createPairingSessionMock).toHaveBeenCalledTimes(1))
    unmount()

    resolveCreate({ ok: true, sessionId: SESSION_ID, expiresAt: new Date(Date.now() + 60_000).toISOString() })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(toDataURLSpy).not.toHaveBeenCalled()
    toDataURLSpy.mockRestore()
  })

  it('renders a translated error when createPairingSession fails', async () => {
    createPairingSessionMock.mockResolvedValue({ ok: false, code: 'auth.access_token_invalid', params: {} })
    renderPairingQr()

    expect((await screen.findByRole('alert')).textContent).toBe('Sua sessão expirou. Entre novamente.')
  })

  it('renders a translated error and stops polling when getPairingClaimStatus fails', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(now + 60_000).toISOString(),
    })
    getPairingClaimStatusMock.mockResolvedValue({ ok: false, code: 'auth.access_token_invalid', params: {} })
    const toDataURLSpy = mockToDataURLForFakeTimers()
    renderPairingQr()

    await flushMicrotasks()
    screen.getByRole('img')

    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(screen.getByRole('alert').textContent).toBe('Sua sessão expirou. Entre novamente.')

    const callsAfterError = getPairingClaimStatusMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(getPairingClaimStatusMock.mock.calls.length).toBe(callsAfterError)
    toDataURLSpy.mockRestore()
  })

  it('ignores a createPairingSession resolution that arrives after the component unmounted', async () => {
    let resolveCreate: (result: deviceApi.CreatePairingSessionResult) => void = () => {}
    createPairingSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )

    const { unmount } = renderPairingQr()
    await waitFor(() => expect(createPairingSessionMock).toHaveBeenCalledTimes(1))
    unmount()

    resolveCreate({ ok: true, sessionId: SESSION_ID, expiresAt: new Date(Date.now() + 60_000).toISOString() })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPairingClaimStatusMock).not.toHaveBeenCalled()
  })

  it('ignores a QRCode.toDataURL resolution that arrives after the component unmounted', async () => {
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    let resolveToDataUrl: (value: string) => void = () => {}
    const toDataURLSpy = vi
      .spyOn(QRCode, 'toDataURL')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveToDataUrl = resolve
          }) as unknown as ReturnType<typeof QRCode.toDataURL>,
      )

    const { unmount } = renderPairingQr()
    await waitFor(() => expect(toDataURLSpy).toHaveBeenCalledTimes(1))
    unmount()

    resolveToDataUrl('data:image/png;base64,fake')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPairingClaimStatusMock).not.toHaveBeenCalled()

    toDataURLSpy.mockRestore()
  })
})
