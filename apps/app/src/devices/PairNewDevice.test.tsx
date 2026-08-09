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

describe('PairNewDevice', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
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
