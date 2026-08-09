import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import { PairingScan } from './PairingScan'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    claimPairingSession: vi.fn(),
  }
})

const claimPairingSessionMock = vi.mocked(client.claimPairingSession)

const NEW_DEVICE_PUBLIC_KEY = 'bmV3LWRldmljZS1wdWJsaWMta2V5'
const PRIMARY_PUBLIC_KEY = 'cHJpbWFyeS1wdWJsaWMta2V5'
const SESSION_ID = 'session-abc'
const BASE_URL = 'http://api.test'
const VALID_QR_TEXT = JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: BASE_URL })

function renderPairingScan(decode: () => Promise<string>, onClaimed: (key: string, sessionId: string) => void = vi.fn()) {
  return render(
    <I18nProvider i18n={i18n}>
      <PairingScan decode={decode} newDevicePublicKeyBase64={NEW_DEVICE_PUBLIC_KEY} onClaimed={onClaimed} />
    </I18nProvider>,
  )
}

describe('PairingScan', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls the injected decode function, then claims the decoded session with its own public key', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })

    renderPairingScan(decode)

    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(claimPairingSessionMock).toHaveBeenCalledWith(BASE_URL, SESSION_ID, NEW_DEVICE_PUBLIC_KEY),
    )
  })

  it('calls onClaimed with the primary public key and session id once the claim succeeds', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })
    const onClaimed = vi.fn()

    renderPairingScan(decode, onClaimed)

    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(PRIMARY_PUBLIC_KEY, SESSION_ID))
  })

  it('renders an error when the claim is rejected (expired or already-claimed session)', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    claimPairingSessionMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })

    renderPairingScan(decode)

    expect((await screen.findByRole('alert')).textContent).toBeTruthy()
  })

  it('renders an error and never calls claimPairingSession when the decoded text is not valid pairing JSON', async () => {
    const decode = vi.fn().mockResolvedValue('not-json-at-all')

    renderPairingScan(decode)

    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })
})
