import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimPairingSession,
  createPairingSession,
  fetchPairingPayload,
  getPairingClaimStatus,
  submitPairingPayload,
} from './api'

const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444'
const ACCESS_TOKEN = 'access-token-xyz'
const SESSION_ID = '55555555-5555-5555-5555-555555555555'
const PRIMARY_PUBLIC_KEY_BASE64 = 'cHJpbWFyeS1wdWJsaWMta2V5'
const NEW_DEVICE_PUBLIC_KEY_BASE64 = 'bmV3LWRldmljZS1wdWJsaWMta2V5'
const ENCRYPTED_KEK_BASE64 = 'ZW5jcnlwdGVkLWtlaw=='

describe('createPairingSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { primaryPublicKey } with a bearer token and returns sessionId + expiresAt on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionId: SESSION_ID, expiresAt: '2026-08-08T12:10:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPairingSession('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PRIMARY_PUBLIC_KEY_BASE64)

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, expiresAt: '2026-08-08T12:10:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/devices/pairing-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ primaryPublicKey: PRIMARY_PUBLIC_KEY_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid access token)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Access token invalid',
      status: 401,
      code: 'auth.access_token_invalid',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPairingSession('http://api.test', ACCOUNT_ID, 'bad-token', PRIMARY_PUBLIC_KEY_BASE64)

    expect(result).toEqual({ ok: false, code: 'auth.access_token_invalid', params: {} })
  })
})

describe('claimPairingSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { newDevicePublicKey } with no auth and returns primaryPublicKey on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ primaryPublicKey: PRIMARY_PUBLIC_KEY_BASE64 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await claimPairingSession('http://api.test', SESSION_ID, NEW_DEVICE_PUBLIC_KEY_BASE64)

    expect(result).toEqual({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY_BASE64 })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/devices/pairing-sessions/${SESSION_ID}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newDevicePublicKey: NEW_DEVICE_PUBLIC_KEY_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (session not found)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Pairing session not found',
      status: 404,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await claimPairingSession('http://api.test', SESSION_ID, NEW_DEVICE_PUBLIC_KEY_BASE64)

    expect(result).toEqual({ ok: false, code: 'auth.device_pairing_session_not_found', params: {} })
  })
})

describe('getPairingClaimStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs claim-status with a bearer token and returns claimed + newDevicePublicKey on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ claimed: true, newDevicePublicKey: NEW_DEVICE_PUBLIC_KEY_BASE64 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPairingClaimStatus('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, SESSION_ID)

    expect(result).toEqual({ ok: true, claimed: true, newDevicePublicKey: NEW_DEVICE_PUBLIC_KEY_BASE64 })
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/accounts/${ACCOUNT_ID}/devices/pairing-sessions/${SESSION_ID}/claim-status`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
    )
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (session not found)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Pairing session not found',
      status: 404,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPairingClaimStatus('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, SESSION_ID)

    expect(result).toEqual({ ok: false, code: 'auth.device_pairing_session_not_found', params: {} })
  })
})

describe('submitPairingPayload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { encryptedKek } with a bearer token and resolves { ok: true } on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitPairingPayload(
      'http://api.test',
      ACCOUNT_ID,
      ACCESS_TOKEN,
      SESSION_ID,
      ENCRYPTED_KEK_BASE64,
    )

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/accounts/${ACCOUNT_ID}/devices/pairing-sessions/${SESSION_ID}/payload`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
        body: JSON.stringify({ encryptedKek: ENCRYPTED_KEK_BASE64 }),
      },
    )
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (payload not ready)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Pairing payload not ready',
      status: 409,
      code: 'auth.device_pairing_payload_not_ready',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitPairingPayload(
      'http://api.test',
      ACCOUNT_ID,
      ACCESS_TOKEN,
      SESSION_ID,
      ENCRYPTED_KEK_BASE64,
    )

    expect(result).toEqual({ ok: false, code: 'auth.device_pairing_payload_not_ready', params: {} })
  })
})

describe('fetchPairingPayload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the payload with no auth and returns encryptedKek on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ encryptedKek: ENCRYPTED_KEK_BASE64 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPairingPayload('http://api.test', SESSION_ID)

    expect(result).toEqual({ ok: true, encryptedKek: ENCRYPTED_KEK_BASE64 })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/devices/pairing-sessions/${SESSION_ID}/payload`)
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (payload not delivered)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Pairing payload not delivered',
      status: 404,
      code: 'auth.device_pairing_payload_not_delivered',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPairingPayload('http://api.test', SESSION_ID)

    expect(result).toEqual({ ok: false, code: 'auth.device_pairing_payload_not_delivered', params: {} })
  })
})
