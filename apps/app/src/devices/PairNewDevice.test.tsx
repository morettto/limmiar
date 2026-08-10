import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { encrypt, deriveChannelKey, generateKeyPair, getSharedSecret } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import { decodeBase64, encodeBase64 } from './base64'
import { PairNewDevice } from './PairNewDevice'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    claimPairingSession: vi.fn(),
    fetchPairingPayload: vi.fn(),
  }
})

const claimPairingSessionMock = vi.mocked(client.claimPairingSession)
const fetchPairingPayloadMock = vi.mocked(client.fetchPairingPayload)

const SESSION_ID = 'session-new-device-flow'
const BASE_URL = 'http://api.test'
const KEK = new Uint8Array(32).fill(0x99)
// Mirrors PairNewDevice.tsx's own (unexported) PAYLOAD_POLL_TIMEOUT_MS.
const PAYLOAD_POLL_TIMEOUT_MS = 2 * 60 * 1000

describe('PairNewDevice', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('renders the scan screen first, before any device has claimed the session', () => {
    const decode = vi.fn().mockReturnValue(new Promise(() => {}))
    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByRole('status').textContent).toBe(
      'Aponte a câmera para o código QR exibido no outro dispositivo.',
    )
  })

  it('derives the channel key from the real primary public key and decrypts the delivered KEK', async () => {
    // Stands in for the "primary device" side: an independently generated real X25519
    // keypair, exactly as PairPrimaryDevice.tsx would generate on its own.
    const primaryKeyPair = generateKeyPair()
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(primaryKeyPair.publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(primaryKeyPair.publicKey) })

    const onKekAdopted = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    await screen.findByRole('status')

    // Wait for claimPairingSession to have been called, so we can read the real public key
    // this device generated for itself.
    await vi.waitFor(() => expect(claimPairingSessionMock).toHaveBeenCalledTimes(1))
    const newDevicePublicKeyBase64 = claimPairingSessionMock.mock.calls[0]![2]
    const newDevicePublicKey = decodeBase64(newDevicePublicKeyBase64)

    // Compute the channel key from the OTHER side of the exchange (the "primary"'s private
    // key + this device's real public key) and encrypt a known KEK to it -- exactly what
    // PairPrimaryDevice.tsx does -- then hand it back as the fetched payload.
    const sharedSecret = getSharedSecret(primaryKeyPair.privateKey, newDevicePublicKey)
    const salt = new TextEncoder().encode(SESSION_ID)
    const channelKey = deriveChannelKey(sharedSecret, salt)
    const encryptedKek = encrypt(channelKey, KEK, salt)
    fetchPairingPayloadMock.mockResolvedValue({ ok: true, encryptedKek: encodeBase64(encryptedKek) })

    await vi.waitFor(() => expect(onKekAdopted).toHaveBeenCalledTimes(1))
    expect(onKekAdopted.mock.calls[0]![0]).toEqual(KEK)
    expect(fetchPairingPayloadMock).toHaveBeenCalledWith(BASE_URL, SESSION_ID)
  })

  it('shows the awaiting-payload status right after the scan is claimed, before a payload arrives', async () => {
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    fetchPairingPayloadMock.mockReturnValue(new Promise(() => {}))

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={vi.fn()} />
      </I18nProvider>,
    )

    await vi.waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Aguardando o outro dispositivo enviar a chave...'),
    )
  })

  it('renders a translated error and never calls onKekAdopted when the delivered KEK cannot be decrypted', async () => {
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    fetchPairingPayloadMock.mockResolvedValue({ ok: true, encryptedKek: encodeBase64(new Uint8Array(48).fill(0x11)) })
    const onKekAdopted = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível decifrar a chave recebida. Tente parear novamente.',
    )
    expect(onKekAdopted).not.toHaveBeenCalled()
  })

  it('polls fetchPairingPayload again after a not-yet-ready response, until it succeeds', async () => {
    const primaryKeyPair = generateKeyPair()
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(primaryKeyPair.publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(primaryKeyPair.publicKey) })
    fetchPairingPayloadMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })
    const onKekAdopted = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    await vi.waitFor(() => expect(claimPairingSessionMock).toHaveBeenCalledTimes(1))
    const newDevicePublicKeyBase64 = claimPairingSessionMock.mock.calls[0]![2]
    const newDevicePublicKey = decodeBase64(newDevicePublicKeyBase64)
    const sharedSecret = getSharedSecret(primaryKeyPair.privateKey, newDevicePublicKey)
    const salt = new TextEncoder().encode(SESSION_ID)
    const channelKey = deriveChannelKey(sharedSecret, salt)
    const encryptedKek = encrypt(channelKey, KEK, salt)

    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))
    fetchPairingPayloadMock.mockResolvedValue({ ok: true, encryptedKek: encodeBase64(encryptedKek) })

    await vi.waitFor(() => expect(onKekAdopted).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(onKekAdopted.mock.calls[0]![0]).toEqual(KEK)
    expect(fetchPairingPayloadMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('gives up and shows a translated error once polling exceeds the pairing session lifetime', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now')
    let dateNowCalls = 0
    dateNowSpy.mockImplementation(() => {
      dateNowCalls += 1
      return dateNowCalls === 1 ? 0 : PAYLOAD_POLL_TIMEOUT_MS
    })

    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    fetchPairingPayloadMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })
    const onKekAdopted = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onKekAdopted).not.toHaveBeenCalled()

    dateNowSpy.mockRestore()
  })

  it('ignores a fetchPairingPayload resolution that arrives after the component unmounted', async () => {
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    let resolvePayload!: (value: Awaited<ReturnType<typeof client.fetchPairingPayload>>) => void
    fetchPairingPayloadMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePayload = resolve
      }),
    )
    const onKekAdopted = vi.fn()

    const { unmount } = render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))
    unmount()

    resolvePayload({ ok: true, encryptedKek: encodeBase64(new Uint8Array(48).fill(0x22)) })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onKekAdopted).not.toHaveBeenCalled()
  })

  it('schedules no further poll once a not-yet-ready response arrives after the component unmounted', async () => {
    vi.useFakeTimers()
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    let resolvePayload!: (value: Awaited<ReturnType<typeof client.fetchPairingPayload>>) => void
    fetchPairingPayloadMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePayload = resolve
      }),
    )

    const { unmount } = render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={vi.fn()} />
      </I18nProvider>,
    )

    for (let i = 0; i < 50 && fetchPairingPayloadMock.mock.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1)
    unmount()

    resolvePayload({ ok: false, code: 'auth.device_pairing_session_not_found', params: {} })
    await vi.advanceTimersByTimeAsync(PAYLOAD_POLL_TIMEOUT_MS)

    expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling well before the real pairing session lifetime elapses', async () => {
    vi.useFakeTimers()
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    fetchPairingPayloadMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={vi.fn()} />
      </I18nProvider>,
    )

    for (let i = 0; i < 50 && fetchPairingPayloadMock.mock.calls.length === 0; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(500)

    expect(screen.getByRole('status').textContent).toBe('Aguardando o outro dispositivo enviar a chave...')
  })

  it('renders an error and never calls onKekAdopted when the claim itself is rejected', async () => {
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: encodeBase64(generateKeyPair().publicKey), u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })
    const onKekAdopted = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onKekAdopted).not.toHaveBeenCalled()
    expect(fetchPairingPayloadMock).not.toHaveBeenCalled()
  })
})
