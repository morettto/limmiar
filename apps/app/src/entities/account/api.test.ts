import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginTotpEnrollment,
  completeWebAuthnCeremony,
  confirmTotpEnrollment,
  continueWithGoogle,
  login,
  logoutSession,
  recoverAccess,
  register,
  registerRecoveryPhrase,
  refreshSession,
  verifyMagicLink,
  verifyTotpChallenge,
} from './api'

describe('logoutSession', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('revoga com o refresh token sem precisar de access token ainda válido e aceita 204 vazio', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    expect(await logoutSession('/api', 'refresh')).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: 'refresh' }),
    })
  })
  it('devolve falha de validação e não engole a falha de conexão', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'validation.invalid_field', params: { field: 'refreshToken' } }), { status: 400 }))
      .mockRejectedValueOnce(new Error('sem conexão')))
    expect(await logoutSession('', '')).toMatchObject({ ok: false, code: 'validation.invalid_field' })
    await expect(logoutSession('', 'refresh')).rejects.toThrow('sem conexão')
  })
  it('não trata HTML da interface com 200 como confirmação de revogação', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Limmiar</html>', { status: 200 })))
    await expect(logoutSession('', 'refresh')).rejects.toThrow('Invalid logout response')
  })
})

describe('refreshSession', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('renova os tokens e preserva uma resposta de rejeição do servidor', async () => {
    const tokens = { accessToken: 'novo', refreshToken: 'novo-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(tokens))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'auth.refresh_token_invalid', params: {} }), { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    expect(await refreshSession('', 'refresh')).toEqual({ ok: true, ...tokens })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ refreshToken: 'refresh' }) })
    expect(await refreshSession('', 'refresh')).toMatchObject({ ok: false, code: 'auth.refresh_token_invalid' })
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
        JSON.stringify({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
      account: {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
        JSON.stringify({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
      account: {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
        JSON.stringify({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
      account: {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
      new Response(JSON.stringify({ backupCodes, accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await confirmTotpEnrollment('http://api.test', ACCOUNT_ID, TICKET, '123456')

    expect(result).toEqual({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',  ok: true, backupCodes })
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
        JSON.stringify({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
      account: {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
        JSON.stringify({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
      account: {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
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
const RECOVERY_ENVELOPE = new Uint8Array(120).fill(7)
const RECOVERY_ENVELOPE_BASE64 = btoa(String.fromCharCode(...RECOVERY_ENVELOPE))

describe('recoverAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs email/recoveryVerifier(base64) and returns the account on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
          id: '66666666-6666-6666-6666-666666666666',
          email: 'pro@example.com',
          role: 'Professional',
          twoFactorRequirement: 'ChallengeRequired',
          twoFactorTicket: 'ticket-recover',
          recoveryEnvelope: RECOVERY_ENVELOPE_BASE64,
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
      account: {accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',
        id: '66666666-6666-6666-6666-666666666666',
        email: 'pro@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: 'ticket-recover',
      },
      recoveryEnvelope: RECOVERY_ENVELOPE,
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
          accountId: ACCOUNT_ID,
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
          accountId: ACCOUNT_ID,
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
      accountId: ACCOUNT_ID,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyMagicLink('http://api.test', { token: 'raw-magic-link-token', patientAccountId: ACCOUNT_ID })
    expect(fetchMock.mock.calls[0]![1].body).toBe(JSON.stringify({ token: 'raw-magic-link-token', patientAccountId: ACCOUNT_ID }))

    expect(result).toEqual({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Assert',
      challenge: CHALLENGE_BASE64,
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: CREDENTIAL_ID_BASE64,
      accountId: ACCOUNT_ID,
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
          email: null,
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
        email: null,
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
          email: null,
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

const ACCESS_TOKEN = 'access-token-xyz'

describe('registerRecoveryPhrase', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { recoveryVerifier(base64) } with a bearer token and resolves { ok: true } on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerRecoveryPhrase('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, RECOVERY_VERIFIER, RECOVERY_ENVELOPE)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/recovery-phrase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ recoveryVerifier: RECOVERY_VERIFIER_BASE64, recoveryEnvelope: RECOVERY_ENVELOPE_BASE64 }),
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

    const result = await registerRecoveryPhrase('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, RECOVERY_VERIFIER, RECOVERY_ENVELOPE)

    expect(result).toEqual({ ok: false, code: 'auth.not_a_professional_account', params: {} })
  })
})
