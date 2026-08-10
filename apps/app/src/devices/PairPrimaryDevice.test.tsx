import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { decrypt, deriveChannelKey, generateKeyPair, getSharedSecret } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import { decodeBase64, encodeBase64 } from './base64'
import { PairPrimaryDevice } from './PairPrimaryDevice'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    createPairingSession: vi.fn(),
    getPairingClaimStatus: vi.fn(),
    submitPairingPayload: vi.fn(),
  }
})

const createPairingSessionMock = vi.mocked(client.createPairingSession)
const getPairingClaimStatusMock = vi.mocked(client.getPairingClaimStatus)
const submitPairingPayloadMock = vi.mocked(client.submitPairingPayload)

const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444'
const ACCESS_TOKEN = 'primary-access-token'
const SESSION_ID = 'session-primary-flow'
const BASE_URL = 'http://api.test'
const KEK = new Uint8Array(32).fill(0x42)

describe('PairPrimaryDevice', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('encrypts the KEK to the claiming device and submits ciphertext a real peer can decrypt', async () => {
    vi.useFakeTimers()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    // Stands in for the "new device" side of the exchange: an independently generated
    // real X25519 keypair, exactly as PairNewDevice.tsx would generate on its own.
    const newDeviceKeyPair = generateKeyPair()
    getPairingClaimStatusMock.mockResolvedValue({
      ok: true,
      claimed: true,
      newDevicePublicKey: encodeBase64(newDeviceKeyPair.publicKey),
    })

    let capturedEncryptedKek: string | undefined
    submitPairingPayloadMock.mockImplementation(async (_baseUrl, _accountId, _accessToken, _sessionId, encryptedKek) => {
      capturedEncryptedKek = encryptedKek
      return { ok: true }
    })

    const getKekForTransfer = vi.fn().mockResolvedValue(KEK.slice())
    const onDelivered = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairPrimaryDevice
          baseUrl={BASE_URL}
          accountId={ACCOUNT_ID}
          accessToken={ACCESS_TOKEN}
          getKekForTransfer={getKekForTransfer}
          onDelivered={onDelivered}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('status').textContent).toBe('Preparando o código para parear o novo dispositivo...')

    // Flush the QR-mount effect (createPairingSession -> toDataURL), same technique as
    // PairingQr.test.tsx -- QRCode's Node renderer schedules via setImmediate, which fake
    // timers intercept, so a single microtask flush isn't enough.
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    // Trigger the claim-status poll that discovers the (fake) claim.
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    // waitFor's own retry loop uses a real setTimeout, which never fires under fake timers
    // -- the microtask-flush loop above already drains the getKekForTransfer -> encrypt ->
    // submitPairingPayload chain, so a direct assertion is enough (and correct: if it
    // hasn't happened by now, waiting longer under fake time wouldn't help either).
    expect(submitPairingPayloadMock).toHaveBeenCalledTimes(1)
    expect(onDelivered).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('Dispositivo pareado com sucesso.')

    // The primary's own public key was whatever it sent to createPairingSession.
    const primaryPublicKeyBase64 = createPairingSessionMock.mock.calls[0]![3]
    const primaryPublicKey = decodeBase64(primaryPublicKeyBase64)

    // Derive the same channel key from the OTHER side of the exchange and decrypt --
    // proves the primary encrypted to a key a real peer can actually reconstruct, not just
    // that *a* ciphertext was submitted.
    const sharedSecret = getSharedSecret(newDeviceKeyPair.privateKey, primaryPublicKey)
    const channelKey = deriveChannelKey(sharedSecret, new TextEncoder().encode(SESSION_ID))
    const decryptedKek = decrypt(channelKey, decodeBase64(capturedEncryptedKek!), new TextEncoder().encode(SESSION_ID))

    expect(decryptedKek).toEqual(KEK)
  })

  it('renders the "delivering" status while the KEK is being fetched and encrypted', async () => {
    vi.useFakeTimers()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const newDeviceKeyPair = generateKeyPair()
    getPairingClaimStatusMock.mockResolvedValue({
      ok: true,
      claimed: true,
      newDevicePublicKey: encodeBase64(newDeviceKeyPair.publicKey),
    })
    const getKekForTransfer = vi.fn().mockReturnValue(new Promise<Uint8Array>(() => {}))

    render(
      <I18nProvider i18n={i18n}>
        <PairPrimaryDevice
          baseUrl={BASE_URL}
          accountId={ACCOUNT_ID}
          accessToken={ACCESS_TOKEN}
          getKekForTransfer={getKekForTransfer}
        />
      </I18nProvider>,
    )

    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(screen.getByRole('status').textContent).toBe('Enviando a chave para o novo dispositivo...')
    expect(submitPairingPayloadMock).not.toHaveBeenCalled()
  })

  it('renders a translated error and never calls onDelivered when the server rejects the delivered payload', async () => {
    vi.useFakeTimers()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const newDeviceKeyPair = generateKeyPair()
    getPairingClaimStatusMock.mockResolvedValue({
      ok: true,
      claimed: true,
      newDevicePublicKey: encodeBase64(newDeviceKeyPair.publicKey),
    })
    submitPairingPayloadMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })
    const getKekForTransfer = vi.fn().mockResolvedValue(KEK.slice())
    const onDelivered = vi.fn()

    render(
      <I18nProvider i18n={i18n}>
        <PairPrimaryDevice
          baseUrl={BASE_URL}
          accountId={ACCOUNT_ID}
          accessToken={ACCESS_TOKEN}
          getKekForTransfer={getKekForTransfer}
          onDelivered={onDelivered}
        />
      </I18nProvider>,
    )

    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onDelivered).not.toHaveBeenCalled()
  })

  it('renders a translated error and does not submit anything when getKekForTransfer fails', async () => {
    vi.useFakeTimers()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const newDeviceKeyPair = generateKeyPair()
    getPairingClaimStatusMock.mockResolvedValue({
      ok: true,
      claimed: true,
      newDevicePublicKey: encodeBase64(newDeviceKeyPair.publicKey),
    })
    const getKekForTransfer = vi.fn().mockRejectedValue(new Error('user cancelled re-authentication'))

    render(
      <I18nProvider i18n={i18n}>
        <PairPrimaryDevice
          baseUrl={BASE_URL}
          accountId={ACCOUNT_ID}
          accessToken={ACCESS_TOKEN}
          getKekForTransfer={getKekForTransfer}
        />
      </I18nProvider>,
    )

    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(screen.getByRole('alert').textContent).toBe(
      'Não foi possível concluir o pareamento com segurança. Tente novamente.',
    )
    expect(submitPairingPayloadMock).not.toHaveBeenCalled()
  })

  it('does not throw when the delivery succeeds without an onDelivered callback', async () => {
    vi.useFakeTimers()
    createPairingSessionMock.mockResolvedValue({
      ok: true,
      sessionId: SESSION_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const newDeviceKeyPair = generateKeyPair()
    getPairingClaimStatusMock.mockResolvedValue({
      ok: true,
      claimed: true,
      newDevicePublicKey: encodeBase64(newDeviceKeyPair.publicKey),
    })
    submitPairingPayloadMock.mockResolvedValue({ ok: true })
    const getKekForTransfer = vi.fn().mockResolvedValue(KEK.slice())

    render(
      <I18nProvider i18n={i18n}>
        <PairPrimaryDevice
          baseUrl={BASE_URL}
          accountId={ACCOUNT_ID}
          accessToken={ACCESS_TOKEN}
          getKekForTransfer={getKekForTransfer}
        />
      </I18nProvider>,
    )

    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(screen.getByRole('status').textContent).toBe('Dispositivo pareado com sucesso.')
  })
})
