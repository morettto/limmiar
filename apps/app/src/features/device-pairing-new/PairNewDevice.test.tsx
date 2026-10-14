import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { encrypt, deriveChannelKey, generateKeyPair, getSharedSecret } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as deviceApi from '../../entities/device/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { preparePairingChannel } from '../../entities/device/pairing-channel'
import { deferred } from '../../test-support/deferred'
import { PairNewDevice } from './PairNewDevice'

vi.mock('../../entities/device/pairing-channel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../entities/device/pairing-channel')>()
  return { ...actual, preparePairingChannel: vi.fn(actual.preparePairingChannel) }
})

vi.mock('../../entities/device/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/device/api')>('../../entities/device/api')
  return {
    ...actual,
    claimPairingSession: vi.fn(),
    fetchPairingPayload: vi.fn(),
  }
})

const claimPairingSessionMock = vi.mocked(deviceApi.claimPairingSession)
const fetchPairingPayloadMock = vi.mocked(deviceApi.fetchPairingPayload)

const SESSION_ID = 'session-new-device-flow'
const BASE_URL = 'http://api.test'
const TEST_PRIMARY_KEY = encodeBase64(generateKeyPair().publicKey)
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

    const onKekAdopted = vi.fn((key: Uint8Array) => { adopted.push(new Uint8Array(key)) })
    const adopted: Uint8Array[] = []

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
    expect(adopted[0]).toEqual(KEK)
    await vi.waitFor(() => expect(onKekAdopted.mock.calls[0]![0]).toEqual(new Uint8Array(32)))
    expect(fetchPairingPayloadMock).toHaveBeenCalledWith(BASE_URL, SESSION_ID)
  })

  it('shows the awaiting-payload status right after the scan is claimed, before a payload arrives', async () => {
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
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
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
    fetchPairingPayloadMock.mockResolvedValue({ ok: true, encryptedKek: encodeBase64(new Uint8Array(48).fill(0x11)) })
    const onKekAdopted = vi.fn((key: Uint8Array) => { adopted.push(new Uint8Array(key)) })
    const adopted: Uint8Array[] = []

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
    const onKekAdopted = vi.fn((key: Uint8Array) => { adopted.push(new Uint8Array(key)) })
    const adopted: Uint8Array[] = []

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
    expect(adopted[0]).toEqual(KEK)
    await vi.waitFor(() => expect(onKekAdopted.mock.calls[0]![0]).toEqual(new Uint8Array(32)))
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
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
    fetchPairingPayloadMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })
    const onKekAdopted = vi.fn((key: Uint8Array) => { adopted.push(new Uint8Array(key)) })
    const adopted: Uint8Array[] = []

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
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
    let resolvePayload!: (value: Awaited<ReturnType<typeof deviceApi.fetchPairingPayload>>) => void
    fetchPairingPayloadMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePayload = resolve
      }),
    )
    const onKekAdopted = vi.fn((key: Uint8Array) => { adopted.push(new Uint8Array(key)) })
    const adopted: Uint8Array[] = []

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
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
    let resolvePayload!: (value: Awaited<ReturnType<typeof deviceApi.fetchPairingPayload>>) => void
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

    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))
    unmount()

    resolvePayload({ ok: false, code: 'auth.device_pairing_session_not_found', params: {} })
    await vi.advanceTimersByTimeAsync(PAYLOAD_POLL_TIMEOUT_MS)

    expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1)
  })

  it('keeps polling for the whole pairing session lifetime and only then gives up', async () => {
    vi.useFakeTimers()
    const decode = vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }))
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
    fetchPairingPayloadMock.mockResolvedValue({ ok: false, code: 'auth.device_pairing_session_not_found', params: {} })
    render(<I18nProvider i18n={i18n}><PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={vi.fn()} /></I18nProvider>)
    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(PAYLOAD_POLL_TIMEOUT_MS - 5000) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Aguardando o outro dispositivo enviar a chave...')

    await act(async () => { await vi.advanceTimersByTimeAsync(7000) })
    expect(screen.getByRole('alert').textContent).toBe('Este código de pareamento não é mais válido. Gere um novo.')
  })

  it('keeps polling well before the real pairing session lifetime elapses', async () => {
    vi.useFakeTimers()
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: TEST_PRIMARY_KEY })
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

    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(500)

    expect(screen.getByRole('status').textContent).toBe('Aguardando o outro dispositivo enviar a chave...')
  })

  it('renders an error and never calls onKekAdopted when the claim itself is rejected', async () => {
    const decode = vi.fn().mockResolvedValue(
      JSON.stringify({ s: SESSION_ID, k: TEST_PRIMARY_KEY, u: BASE_URL }),
    )
    claimPairingSessionMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })
    const onKekAdopted = vi.fn((key: Uint8Array) => { adopted.push(new Uint8Array(key)) })
    const adopted: Uint8Array[] = []

    render(
      <I18nProvider i18n={i18n}>
        <PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} />
      </I18nProvider>,
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onKekAdopted).not.toHaveBeenCalled()
    expect(fetchPairingPayloadMock).not.toHaveBeenCalled()
  })

  const canalAtual = async () => (await vi.mocked(preparePairingChannel).mock.results.at(-1)!.value) as { channelKey: Uint8Array }

  async function parearAteEsperar(onKekAdopted: (key: Uint8Array) => void | Promise<void>) {
    const primaryKeyPair = generateKeyPair()
    const decode = vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID, k: encodeBase64(primaryKeyPair.publicKey), u: BASE_URL }))
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(primaryKeyPair.publicKey) })
    const view = render(<I18nProvider i18n={i18n}><PairNewDevice baseUrl={BASE_URL} decode={decode} onKekAdopted={onKekAdopted} /></I18nProvider>)
    await vi.waitFor(() => expect(claimPairingSessionMock).toHaveBeenCalledTimes(1))
    const secret = getSharedSecret(primaryKeyPair.privateKey, decodeBase64(claimPairingSessionMock.mock.calls[0]![2]))
    const salt = new TextEncoder().encode(SESSION_ID)
    const encryptedKek = encrypt(deriveChannelKey(secret, salt), KEK, salt)
    return { view, decode, enviar: () => fetchPairingPayloadMock.mockResolvedValue({ ok: true, encryptedKek: encodeBase64(encryptedKek) }) }
  }

  it('after adopting the key it confirms, zeroes the channel key and never polls again', async () => {
    fetchPairingPayloadMock.mockResolvedValue({ ok: false, code: 'auth.device_pairing_session_not_found', params: {} })
    const { enviar } = await parearAteEsperar(vi.fn())
    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))
    enviar()
    expect(await screen.findByText('Dispositivo pareado com sucesso.', {}, { timeout: 3000 })).toBeTruthy()
    const chamadas = fetchPairingPayloadMock.mock.calls.length
    expect((await canalAtual()).channelKey.every((byte) => byte === 0)).toBe(true)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)) })
    expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(chamadas)
  })

  it('zeroes the channel key when the delivered KEK cannot be adopted', async () => {
    const { enviar } = await parearAteEsperar(vi.fn().mockRejectedValue(new Error('importação falhou')))
    enviar()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível decifrar a chave recebida. Tente parear novamente.')
    expect((await canalAtual()).channelKey.every((byte) => byte === 0)).toBe(true)
  })

  it('zeroes the channel key when leaving while waiting for the payload', async () => {
    fetchPairingPayloadMock.mockReturnValue(new Promise(() => {}))
    const { view } = await parearAteEsperar(vi.fn())
    await screen.findByText('Aguardando o outro dispositivo enviar a chave...')
    const canal = await canalAtual()
    expect(canal.channelKey.some((byte) => byte !== 0)).toBe(true)
    view.unmount()
    expect(canal.channelKey.every((byte) => byte === 0)).toBe(true)
  })

  it('a payload failure from a previous server address does not break the current wait', async () => {
    const antiga = deferred<Awaited<ReturnType<typeof deviceApi.fetchPairingPayload>>>()
    fetchPairingPayloadMock.mockReturnValueOnce(antiga.promise).mockReturnValue(new Promise(() => {}))
    const { view, decode } = await parearAteEsperar(vi.fn())
    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(1))
    view.rerender(<I18nProvider i18n={i18n}><PairNewDevice baseUrl="http://outra.test" decode={decode} onKekAdopted={vi.fn()} /></I18nProvider>)
    await vi.waitFor(() => expect(fetchPairingPayloadMock).toHaveBeenCalledTimes(2))
    const canal = await canalAtual()

    await act(async () => antiga.reject(new Error('rede')))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(canal.channelKey.some((byte) => byte !== 0)).toBe(true)
  })
})
