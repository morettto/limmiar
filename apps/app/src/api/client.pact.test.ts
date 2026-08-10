import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MatchersV3, PactV3 } from '@pact-foundation/pact'
import { dynamicActivate, i18n } from '../i18n'
import { translateProblemCode } from '../errors/problem-messages'
import { getHealthDb, login, register } from './client'

// Deliberately NOT `new URL('../../../../pacts', import.meta.url)`: under
// this file's jsdom test environment, Vite's transform special-cases that
// exact syntactic pattern as a browser asset-URL import and rewrites it to a
// dev-server "/@fs/..." URL instead of leaving it as a real file path.
// Resolving the two steps separately (bare `import.meta.url`, then
// `path.resolve`) sidesteps that rewrite and keeps a genuine filesystem path.
// 4 levels up from apps/app/src/api/ to the repo root: api -> src -> app ->
// apps -> repo root. Both this consumer test and the .NET provider
// verification test (written separately) read/write the exact same
// pacts/limmiar-app-limmiar-api.json file, so they must agree on this path.
const currentFile = fileURLToPath(import.meta.url)
const pactDir = path.resolve(path.dirname(currentFile), '../../../../pacts')

const provider = new PactV3({
  consumer: 'limmiar-app',
  provider: 'limmiar-api',
  dir: pactDir,
})

describe('GET /health/db — Pact consumer contract (limmiar-app / limmiar-api)', () => {
  it('translates a 503 "database unreachable" problem+json response into the expected pt-BR message', async () => {
    // Real compiled pt-BR catalog, same activation path as the running app
    // (see apps/app/src/i18n.test.ts) — not a hand-rolled in-memory catalog,
    // so this test also catches the message going missing from the catalog.
    await dynamicActivate('pt-BR')

    provider
      .given('the database is unreachable')
      .uponReceiving('a request to check database health')
      .withRequest({
        method: 'GET',
        path: '/health/db',
      })
      .willRespondWith({
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
        body: {
          type: MatchersV3.like('about:blank'),
          title: MatchersV3.like('Database unreachable'),
          status: MatchersV3.like(503),
          // Exact string match, not a matcher: the client looks this code up
          // as a plain object key, so the contract must pin the literal value.
          code: 'health.database_unreachable',
          params: {},
        },
      })

    await provider.executeTest(async (mockServer) => {
      const result = await getHealthDb(mockServer.url)

      if (result.ok) {
        throw new Error('expected getHealthDb to report the database as unreachable')
      }

      expect(result.code).toBe('health.database_unreachable')
      expect(result.params).toEqual({})

      const message = translateProblemCode(result.code, result.params, i18n)

      expect(message).toBe('Banco de dados indisponível no momento.')
    })
  })
})

// 32 bytes of 0x0a, base64-encoded (System.Text.Json's byte[] wire format --
// see client.ts's passwordVerifierToBase64). The actual Argon2id derivation
// is covered on its own in auth/password-verifier.test.ts; these contract
// interactions only need SOME 32-byte value on the wire.
const PASSWORD_VERIFIER = new Uint8Array(32).fill(0x0a)
const PASSWORD_VERIFIER_BASE64 = 'CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo='

describe('POST /auth/register — Pact consumer contract', () => {
  it('registers a new professional account and returns it (201)', async () => {
    await dynamicActivate('pt-BR')

    provider
      .given('no account exists for s02-01-pact-register@example.com')
      .uponReceiving('a request to register a new professional account by e-mail')
      .withRequest({
        method: 'POST',
        path: '/auth/register',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: 's02-01-pact-register@example.com',
          passwordVerifier: PASSWORD_VERIFIER_BASE64,
          role: 'Professional',
        },
      })
      .willRespondWith({
        status: 201,
        body: {
          id: MatchersV3.uuid(),
          email: 's02-01-pact-register@example.com',
          role: 'Professional',
        },
      })

    await provider.executeTest(async (mockServer) => {
      const result = await register(mockServer.url, {
        email: 's02-01-pact-register@example.com',
        passwordVerifier: PASSWORD_VERIFIER,
        role: 'Professional',
      })

      if (!result.ok) {
        throw new Error('expected register to succeed')
      }

      expect(result.account.email).toBe('s02-01-pact-register@example.com')
      expect(result.account.role).toBe('Professional')
    })
  })

  it('translates a 400 "invalid field" problem+json response for a missing e-mail into the expected pt-BR message', async () => {
    await dynamicActivate('pt-BR')

    provider
      .given('the request is missing a required field')
      .uponReceiving('a request to register with an empty e-mail')
      .withRequest({
        method: 'POST',
        path: '/auth/register',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: '',
          passwordVerifier: PASSWORD_VERIFIER_BASE64,
          role: 'Professional',
        },
      })
      .willRespondWith({
        status: 400,
        headers: { 'Content-Type': 'application/problem+json' },
        body: {
          type: MatchersV3.like('about:blank'),
          title: MatchersV3.like('Invalid request'),
          status: MatchersV3.like(400),
          code: 'validation.invalid_field',
          params: { field: 'email' },
        },
      })

    await provider.executeTest(async (mockServer) => {
      const result = await register(mockServer.url, {
        email: '',
        passwordVerifier: PASSWORD_VERIFIER,
        role: 'Professional',
      })

      if (result.ok) {
        throw new Error('expected register to report a validation error')
      }

      expect(result.code).toBe('validation.invalid_field')
      expect(result.params).toEqual({ field: 'email' })

      const message = translateProblemCode(result.code, result.params, i18n)

      expect(message).toBe('Campo inválido: email.')
    })
  })
})

describe('POST /auth/login — Pact consumer contract', () => {
  it('translates a 401 "invalid credentials" problem+json response into the expected pt-BR message', async () => {
    await dynamicActivate('pt-BR')

    provider
      .given('no account exists for s02-01-pact-login-unknown@example.com')
      .uponReceiving('a request to log in with an unrecognized e-mail')
      .withRequest({
        method: 'POST',
        path: '/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: 's02-01-pact-login-unknown@example.com',
          passwordVerifier: PASSWORD_VERIFIER_BASE64,
        },
      })
      .willRespondWith({
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
        body: {
          type: MatchersV3.like('about:blank'),
          title: MatchersV3.like('Invalid credentials'),
          status: MatchersV3.like(401),
          code: 'auth.invalid_credentials',
          params: {},
        },
      })

    await provider.executeTest(async (mockServer) => {
      const result = await login(mockServer.url, {
        email: 's02-01-pact-login-unknown@example.com',
        passwordVerifier: PASSWORD_VERIFIER,
      })

      if (result.ok) {
        throw new Error('expected login to report invalid credentials')
      }

      expect(result.code).toBe('auth.invalid_credentials')

      const message = translateProblemCode(result.code, result.params, i18n)

      expect(message).toBe('E-mail ou senha inválidos.')
    })
  })
})
