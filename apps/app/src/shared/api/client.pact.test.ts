import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MatchersV3, PactV3 } from '@pact-foundation/pact'
import { dynamicActivate, i18n } from '../i18n'
import { translateProblemCode } from './problem-messages'
import { getHealthDb } from './client'

// Deliberately NOT `new URL('../../../../../pacts', import.meta.url)`: under
// this file's jsdom test environment, Vite's transform special-cases that
// exact syntactic pattern as a browser asset-URL import and rewrites it to a
// dev-server "/@fs/..." URL instead of leaving it as a real file path.
// Resolving the two steps separately (bare `import.meta.url`, then
// `path.resolve`) sidesteps that rewrite and keeps a genuine filesystem path.
// 5 levels up from apps/app/src/shared/api/ to the repo root: api -> shared ->
// src -> app -> apps -> repo root. Both this consumer test and the .NET
// provider verification test (written separately) read/write the exact same
// pacts/limmiar-app-limmiar-api.json file, so they must agree on this path.
const currentFile = fileURLToPath(import.meta.url)
const pactDir = path.resolve(path.dirname(currentFile), '../../../../../pacts')

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
