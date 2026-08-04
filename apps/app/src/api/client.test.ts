import { afterEach, describe, expect, it, vi } from 'vitest'
import { continueWithGoogle, getHealthDb, login, register } from './client'

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
        JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', email: 'user@example.com', role: 'Professional' }),
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
      account: { id: '11111111-1111-1111-1111-111111111111', email: 'user@example.com', role: 'Professional' },
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
        JSON.stringify({ id: '22222222-2222-2222-2222-222222222222', email: 'user@example.com', role: 'Patient' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await login('http://api.test', { email: 'user@example.com', passwordVerifier: PASSWORD_VERIFIER })

    expect(result).toEqual({
      ok: true,
      account: { id: '22222222-2222-2222-2222-222222222222', email: 'user@example.com', role: 'Patient' },
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
      account: { id: '33333333-3333-3333-3333-333333333333', email: 'user@example.com', role: 'Professional' },
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
