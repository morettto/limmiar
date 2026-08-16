import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../devices/base64'
import {
  appendPatientEntry,
  beginTotpEnrollment,
  claimPairingSession,
  completeWebAuthnCeremony,
  confirmTotpEnrollment,
  continueWithGoogle,
  createPairingSession,
  createPatient,
  fetchPairingPayload,
  getHealthDb,
  getPairingClaimStatus,
  getPatientRecord,
  listPatients,
  login,
  recoverAccess,
  register,
  registerRecoveryPhrase,
  requestMagicLink,
  submitPairingPayload,
  verifyMagicLink,
  verifyTotpChallenge,
} from './client'

describe('getHealthDb', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns { ok: true } on a 2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getHealthDb('http://api.test')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/health/db')
  })

  it('returns { ok: false, code, params } parsed from the problem+json body on a non-2xx response', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Database unreachable',
      status: 503,
      code: 'health.database_unreachable',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getHealthDb('http://api.test')).resolves.toEqual({
      ok: false,
      code: 'health.database_unreachable',
      params: {},
    })
  })
})

// 32 bytes of 0x0a, base64-encoded — exactly how System.Text.Json serializes
// a .NET byte[] (RegisterRequest/LoginRequest.PasswordVerifier), so this
// pins the wire format the client must send (never the plaintext password).
const PASSWORD_VERIFIER = new Uint8Array(32).fill(0x0a)
const PASSWORD_VERIFIER_BASE64 = 'CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo='

describe('register', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs email/passwordVerifier(base64)/role and returns the created account on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '11111111-1111-1111-1111-111111111111',
          email: 'user@example.com',
          role: 'Professional',
          twoFactorRequirement: 'SetupRequired',
          twoFactorTicket: 'ticket-register',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await register('http://api.test', {
      email: 'user@example.com',
      passwordVerifier: PASSWORD_VERIFIER,
      role: 'Professional',
    })

    expect(result).toEqual({
      ok: true,
      account: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        role: 'Professional',
        twoFactorRequirement: 'SetupRequired',
        twoFactorTicket: 'ticket-register',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        passwordVerifier: PASSWORD_VERIFIER_BASE64,
        role: 'Professional',
      }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (e-mail already registered)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Email already registered',
      status: 409,
      code: 'auth.email_already_registered',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await register('http://api.test', {
      email: 'user@example.com',
      passwordVerifier: PASSWORD_VERIFIER,
      role: 'Patient',
    })

    expect(result).toEqual({ ok: false, code: 'auth.email_already_registered', params: {} })
  })
})

describe('login', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs email/passwordVerifier(base64) (no role) and returns the account on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '22222222-2222-2222-2222-222222222222',
          email: 'user@example.com',
          role: 'Patient',
          twoFactorRequirement: 'NotApplicable',
          twoFactorTicket: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await login('http://api.test', { email: 'user@example.com', passwordVerifier: PASSWORD_VERIFIER })

    expect(result).toEqual({
      ok: true,
      account: {
        id: '22222222-2222-2222-2222-222222222222',
        email: 'user@example.com',
        role: 'Patient',
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', passwordVerifier: PASSWORD_VERIFIER_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid credentials)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid credentials',
      status: 401,
      code: 'auth.invalid_credentials',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await login('http://api.test', { email: 'user@example.com', passwordVerifier: PASSWORD_VERIFIER })

    expect(result).toEqual({ ok: false, code: 'auth.invalid_credentials', params: {} })
  })
})

describe('continueWithGoogle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs idToken/requestedRole and returns the account + isNewAccount on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '33333333-3333-3333-3333-333333333333',
          email: 'user@example.com',
          role: 'Professional',
          twoFactorRequirement: 'ChallengeRequired',
          twoFactorTicket: 'ticket-google',
          isNewAccount: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await continueWithGoogle('http://api.test', {
      idToken: 'google-id-token',
      requestedRole: 'Professional',
    })

    expect(result).toEqual({
      ok: true,
      account: {
        id: '33333333-3333-3333-3333-333333333333',
        email: 'user@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: 'ticket-google',
      },
      isNewAccount: true,
    })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'google-id-token', requestedRole: 'Professional' }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid Google token)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid Google token',
      status: 401,
      code: 'auth.google_token_invalid',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await continueWithGoogle('http://api.test', { idToken: 'bad-token', requestedRole: 'Patient' })

    expect(result).toEqual({ ok: false, code: 'auth.google_token_invalid', params: {} })
  })
})

const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444'
const TICKET = 'two-factor-ticket-abc'

describe('beginTotpEnrollment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { ticket } to /accounts/{accountId}/totp and returns the secret + provisioningUri on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          secret: 'JBSWY3DPEHPK3PXP',
          provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await beginTotpEnrollment('http://api.test', ACCOUNT_ID, TICKET)

    expect(result).toEqual({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: TICKET }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid/missing ticket)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid or missing two-factor ticket',
      status: 401,
      code: 'auth.totp_ticket_invalid',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await beginTotpEnrollment('http://api.test', ACCOUNT_ID, 'wrong-ticket')

    expect(result).toEqual({ ok: false, code: 'auth.totp_ticket_invalid', params: {} })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (TOTP already enabled)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'TOTP is already enabled for this account',
      status: 409,
      code: 'auth.totp_already_enabled',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await beginTotpEnrollment('http://api.test', ACCOUNT_ID, TICKET)

    expect(result).toEqual({ ok: false, code: 'auth.totp_already_enabled', params: {} })
  })
})

describe('confirmTotpEnrollment', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { ticket, code } and returns the 10 backup codes on 200', async () => {
    const backupCodes = Array.from({ length: 10 }, (_, index) => `abcde-${index}0000`)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ backupCodes }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await confirmTotpEnrollment('http://api.test', ACCOUNT_ID, TICKET, '123456')

    expect(result).toEqual({ ok: true, backupCodes })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/totp/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: TICKET, code: '123456' }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (invalid TOTP code)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid TOTP code',
      status: 409,
      code: 'auth.totp_invalid_code',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await confirmTotpEnrollment('http://api.test', ACCOUNT_ID, TICKET, '000000')

    expect(result).toEqual({ ok: false, code: 'auth.totp_invalid_code', params: {} })
  })
})

describe('verifyTotpChallenge', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { ticket, code } and returns the authenticated account on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: ACCOUNT_ID,
          email: 'user@example.com',
          role: 'Professional',
          twoFactorRequirement: 'ChallengeRequired',
          twoFactorTicket: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTotpChallenge('http://api.test', ACCOUNT_ID, TICKET, { code: '123456' })

    expect(result).toEqual({
      ok: true,
      account: {
        id: ACCOUNT_ID,
        email: 'user@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: null,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/totp/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: TICKET, code: '123456' }),
    })
  })

  it('POSTs { ticket, backupCode } and returns the authenticated account on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: ACCOUNT_ID,
          email: 'user@example.com',
          role: 'Professional',
          twoFactorRequirement: 'ChallengeRequired',
          twoFactorTicket: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTotpChallenge('http://api.test', ACCOUNT_ID, TICKET, { backupCode: 'abcde-12345' })

    expect(result).toEqual({
      ok: true,
      account: {
        id: ACCOUNT_ID,
        email: 'user@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: null,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/totp/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: TICKET, backupCode: 'abcde-12345' }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid code)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid TOTP code or backup code',
      status: 401,
      code: 'auth.totp_invalid_code',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyTotpChallenge('http://api.test', ACCOUNT_ID, TICKET, { code: '999999' })

    expect(result).toEqual({ ok: false, code: 'auth.totp_invalid_code', params: {} })
  })
})

const RECOVERY_VERIFIER = new Uint8Array(32).fill(0x0b)
const RECOVERY_VERIFIER_BASE64 = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws='

describe('recoverAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs email/recoveryVerifier(base64) and returns the account on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '66666666-6666-6666-6666-666666666666',
          email: 'pro@example.com',
          role: 'Professional',
          twoFactorRequirement: 'ChallengeRequired',
          twoFactorTicket: 'ticket-recover',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await recoverAccess('http://api.test', {
      email: 'pro@example.com',
      recoveryVerifier: RECOVERY_VERIFIER,
    })

    expect(result).toEqual({
      ok: true,
      account: {
        id: '66666666-6666-6666-6666-666666666666',
        email: 'pro@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: 'ticket-recover',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pro@example.com', recoveryVerifier: RECOVERY_VERIFIER_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid recovery phrase)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid recovery phrase',
      status: 401,
      code: 'auth.invalid_recovery_phrase',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await recoverAccess('http://api.test', {
      email: 'pro@example.com',
      recoveryVerifier: RECOVERY_VERIFIER,
    })

    expect(result).toEqual({ ok: false, code: 'auth.invalid_recovery_phrase', params: {} })
  })
})

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

describe('requestMagicLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { email } and resolves { ok: true } on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestMagicLink('http://api.test', { email: 'patient@example.com' })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/magic-link/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'patient@example.com' }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 400 (missing e-mail)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid request',
      status: 400,
      code: 'validation.invalid_field',
      params: { field: 'email' },
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 400, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestMagicLink('http://api.test', { email: '' })

    expect(result).toEqual({ ok: false, code: 'validation.invalid_field', params: { field: 'email' } })
  })
})

const MAGIC_LINK_TICKET = 'magic-link-ticket-abc'
const CHALLENGE_BASE64 = 'Y2hhbGxlbmdlLWJ5dGVz'
const RELYING_PARTY_ID = 'limmiar.test'
const CREDENTIAL_ID_BASE64 = 'Y3JlZGVudGlhbC1pZA=='

describe('verifyMagicLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { token } and returns a Register ceremony (no credentialId) on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          magicLinkTicket: MAGIC_LINK_TICKET,
          ceremonyType: 'Register',
          challenge: CHALLENGE_BASE64,
          relyingPartyId: RELYING_PARTY_ID,
          credentialId: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyMagicLink('http://api.test', { token: 'raw-magic-link-token' })

    expect(result).toEqual({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: CHALLENGE_BASE64,
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'raw-magic-link-token' }),
    })
  })

  it('returns an Assert ceremony (with credentialId) on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          magicLinkTicket: MAGIC_LINK_TICKET,
          ceremonyType: 'Assert',
          challenge: CHALLENGE_BASE64,
          relyingPartyId: RELYING_PARTY_ID,
          credentialId: CREDENTIAL_ID_BASE64,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyMagicLink('http://api.test', { token: 'raw-magic-link-token' })

    expect(result).toEqual({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Assert',
      challenge: CHALLENGE_BASE64,
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: CREDENTIAL_ID_BASE64,
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (invalid magic link)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid magic link',
      status: 401,
      code: 'auth.magic_link_invalid',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyMagicLink('http://api.test', { token: 'expired-or-unknown-token' })

    expect(result).toEqual({ ok: false, code: 'auth.magic_link_invalid', params: {} })
  })
})

const CLIENT_DATA_JSON_BASE64 = 'Y2xpZW50LWRhdGEtanNvbg=='
const ATTESTATION_OBJECT_BASE64 = 'YXR0ZXN0YXRpb24tb2JqZWN0'
const AUTHENTICATOR_DATA_BASE64 = 'YXV0aGVudGljYXRvci1kYXRh'
const SIGNATURE_BASE64 = 'c2lnbmF0dXJl'

describe('completeWebAuthnCeremony', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs a Register-shaped body (attestationObject, no authenticatorData/signature) and returns the account + tokens on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '88888888-8888-8888-8888-888888888888',
          email: 'patient@example.com',
          role: 'Patient',
          accessToken: 'access-token-magic',
          refreshToken: 'refresh-token-magic',
          accessTokenExpiresAt: '2026-08-09T13:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeWebAuthnCeremony('http://api.test', {
      magicLinkTicket: MAGIC_LINK_TICKET,
      credentialId: CREDENTIAL_ID_BASE64,
      clientDataJson: CLIENT_DATA_JSON_BASE64,
      attestationObject: ATTESTATION_OBJECT_BASE64,
    })

    expect(result).toEqual({
      ok: true,
      account: {
        id: '88888888-8888-8888-8888-888888888888',
        email: 'patient@example.com',
        role: 'Patient',
        accessToken: 'access-token-magic',
        refreshToken: 'refresh-token-magic',
        accessTokenExpiresAt: '2026-08-09T13:00:00Z',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/magic-link/webauthn/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magicLinkTicket: MAGIC_LINK_TICKET,
        credentialId: CREDENTIAL_ID_BASE64,
        clientDataJson: CLIENT_DATA_JSON_BASE64,
        attestationObject: ATTESTATION_OBJECT_BASE64,
      }),
    })
  })

  it('POSTs an Assert-shaped body (authenticatorData + signature, no attestationObject)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '99999999-9999-9999-9999-999999999999',
          email: 'patient@example.com',
          role: 'Patient',
          accessToken: 'access-token-magic-2',
          refreshToken: 'refresh-token-magic-2',
          accessTokenExpiresAt: '2026-08-09T13:05:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeWebAuthnCeremony('http://api.test', {
      magicLinkTicket: MAGIC_LINK_TICKET,
      credentialId: CREDENTIAL_ID_BASE64,
      clientDataJson: CLIENT_DATA_JSON_BASE64,
      authenticatorData: AUTHENTICATOR_DATA_BASE64,
      signature: SIGNATURE_BASE64,
    })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/magic-link/webauthn/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magicLinkTicket: MAGIC_LINK_TICKET,
        credentialId: CREDENTIAL_ID_BASE64,
        clientDataJson: CLIENT_DATA_JSON_BASE64,
        authenticatorData: AUTHENTICATOR_DATA_BASE64,
        signature: SIGNATURE_BASE64,
      }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401 (ceremony failed)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'WebAuthn ceremony failed',
      status: 401,
      code: 'auth.webauthn_ceremony_failed',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeWebAuthnCeremony('http://api.test', {
      magicLinkTicket: MAGIC_LINK_TICKET,
      credentialId: CREDENTIAL_ID_BASE64,
      clientDataJson: CLIENT_DATA_JSON_BASE64,
      attestationObject: ATTESTATION_OBJECT_BASE64,
    })

    expect(result).toEqual({ ok: false, code: 'auth.webauthn_ceremony_failed', params: {} })
  })
})

describe('registerRecoveryPhrase', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { recoveryVerifier(base64) } with a bearer token and resolves { ok: true } on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerRecoveryPhrase('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, RECOVERY_VERIFIER)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/recovery-phrase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ recoveryVerifier: RECOVERY_VERIFIER_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (not a professional account)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Account is not a professional account',
      status: 409,
      code: 'auth.not_a_professional_account',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerRecoveryPhrase('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, RECOVERY_VERIFIER)

    expect(result).toEqual({ ok: false, code: 'auth.not_a_professional_account', params: {} })
  })
})

const PATIENT_ID = '99999999-9999-9999-9999-999999999999'
const WRAPPED_DEK = new Uint8Array([0x01, 0x02, 0x03])
const CIPHERTEXT = new Uint8Array([0xaa, 0xbb, 0xcc])
const WRAPPED_DEK_BASE64 = encodeBase64(WRAPPED_DEK)
const CIPHERTEXT_BASE64 = encodeBase64(CIPHERTEXT)

describe('createPatient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { patientId, wrappedDek(base64), ciphertext(base64) } with a bearer token and returns patientId + createdAt on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ patientId: PATIENT_ID, createdAt: '2026-08-14T10:00:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPatient('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      patientId: PATIENT_ID,
      wrappedDek: WRAPPED_DEK,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: true, patientId: PATIENT_ID, createdAt: '2026-08-14T10:00:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ patientId: PATIENT_ID, wrappedDek: WRAPPED_DEK_BASE64, ciphertext: CIPHERTEXT_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (patient already exists)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Patient already exists',
      status: 409,
      code: 'patients.entry_sequence_conflict',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPatient('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      patientId: PATIENT_ID,
      wrappedDek: WRAPPED_DEK,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: false, code: 'patients.entry_sequence_conflict', params: {} })
  })
})

describe('appendPatientEntry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { sequence, ciphertext(base64) } with a bearer token and returns entryId + sequence + createdAt on 201', async () => {
    const entryId = '77777777-7777-7777-7777-777777777777'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ entryId, sequence: 2, createdAt: '2026-08-14T10:05:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await appendPatientEntry('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID, {
      sequence: 2,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: true, entryId, sequence: 2, createdAt: '2026-08-14T10:05:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ sequence: 2, ciphertext: CIPHERTEXT_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (patient not found)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Patient not found',
      status: 404,
      code: 'patients.not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await appendPatientEntry('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID, {
      sequence: 2,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: false, code: 'patients.not_found', params: {} })
  })
})

describe('getPatientRecord', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the record with a bearer token and base64-decodes wrappedDek + every entry ciphertext', async () => {
    const entryId = '66666666-6666-6666-6666-666666666666'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          patientId: PATIENT_ID,
          wrappedDek: WRAPPED_DEK_BASE64,
          createdAt: '2026-08-14T10:00:00Z',
          lastEntryAt: '2026-08-14T10:05:00Z',
          entries: [{ entryId, sequence: 1, ciphertext: CIPHERTEXT_BASE64, createdAt: '2026-08-14T10:00:00Z' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPatientRecord('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({
      ok: true,
      patientId: PATIENT_ID,
      wrappedDek: WRAPPED_DEK,
      createdAt: '2026-08-14T10:00:00Z',
      lastEntryAt: '2026-08-14T10:05:00Z',
      entries: [{ entryId, sequence: 1, ciphertext: CIPHERTEXT, createdAt: '2026-08-14T10:00:00Z' }],
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (unknown or another tenant\'s patient)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Patient not found',
      status: 404,
      code: 'patients.not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getPatientRecord('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({ ok: false, code: 'patients.not_found', params: {} })
  })
})

describe('listPatients', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the wallet with a bearer token and base64-decodes wrappedDek + ciphertext per patient', async () => {
    const otherPatientId = '77777777-7777-7777-7777-777777777777'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          patients: [
            { patientId: PATIENT_ID, wrappedDek: WRAPPED_DEK_BASE64, ciphertext: CIPHERTEXT_BASE64, createdAt: '2026-08-14T10:00:00Z' },
            { patientId: otherPatientId, wrappedDek: WRAPPED_DEK_BASE64, ciphertext: CIPHERTEXT_BASE64, createdAt: '2026-08-15T10:00:00Z' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listPatients('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({
      ok: true,
      patients: [
        { patientId: PATIENT_ID, wrappedDek: WRAPPED_DEK, ciphertext: CIPHERTEXT, createdAt: '2026-08-14T10:00:00Z' },
        { patientId: otherPatientId, wrappedDek: WRAPPED_DEK, ciphertext: CIPHERTEXT, createdAt: '2026-08-15T10:00:00Z' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on a non-2xx response', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'auth.forbidden',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listPatients('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'auth.forbidden', params: {} })
  })
})
