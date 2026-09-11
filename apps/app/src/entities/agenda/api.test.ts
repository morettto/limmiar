import { afterEach, describe, expect, it, vi } from 'vitest'
import { listarSessoes } from './api'

const ACCOUNT_ID = '44444444-4444-4444-4444-444444444444'
const ACCESS_TOKEN = 'access-token-xyz'

describe('listarSessoes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs …/agenda/sessions?from=&to= (encoded ISO) with a bearer token and maps the 4 fields', async () => {
    const de = new Date('2026-09-10T10:00:00.000Z')
    const ate = new Date('2026-09-17T10:00:00.000Z')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              sessionId: 's-1',
              patientId: 'p-1',
              startsAt: '2026-09-10T11:00:00Z',
              durationMinutes: 50,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listarSessoes('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, de, ate)

    // toStrictEqual, não toEqual -- o backend já não manda cancelledAt, e toEqual ignoraria
    // um canceladaEm: undefined remanescente no mapeamento, ficando verde sem provar nada.
    expect(result).toStrictEqual({
      ok: true,
      sessoes: [
        {
          sessionId: 's-1',
          patientId: 'p-1',
          inicioEm: '2026-09-10T11:00:00Z',
          duracaoMinutos: 50,
        },
      ],
    })
    const expectedUrl = `http://api.test/accounts/${ACCOUNT_ID}/agenda/sessions?from=${encodeURIComponent(de.toISOString())}&to=${encodeURIComponent(ate.toISOString())}`
    expect(fetchMock).toHaveBeenCalledWith(expectedUrl, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 403, intact', async () => {
    const problem = { type: 'about:blank', title: 'Forbidden', status: 403, code: 'auth.forbidden', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listarSessoes('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, new Date(), new Date())

    expect(result).toEqual({ ok: false, code: 'auth.forbidden', params: {} })
  })
})
