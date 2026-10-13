import { afterEach, describe, expect, it, vi } from 'vitest'
import { agendarSessao, remarcarSessao, cancelarSessao, listarSessoes } from './api'

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

it('agenda envia métodos, IDs opacos e horários para as rotas autenticadas', async () => {
  const fetch = vi.fn().mockImplementation(async (_url: string, opcoes: { method: string }) =>
    opcoes.method === 'POST' ? new Response(JSON.stringify({ sessionId: 'sessao-nova' }), { status: 201 }) : new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  try {
    expect(await agendarSessao('', 'conta', 'token', 'paciente', '2026-10-04T14:00:00Z', 50)).toEqual({ ok: true, sessionId: 'sessao-nova' })
    await remarcarSessao('', 'conta', 'token', 'sessao', '2026-10-04T15:00:00Z', 30)
    await cancelarSessao('', 'conta', 'token', 'sessao')
    expect(fetch.mock.calls.map(([url, opcoes]) => [url, opcoes.method, opcoes.headers.Authorization,
      opcoes.body ? JSON.parse(opcoes.body) : null])).toEqual([
      ['/accounts/conta/agenda/sessions', 'POST', 'Bearer token', { patientId: 'paciente', startsAt: '2026-10-04T14:00:00Z', durationMinutes: 50 }],
      ['/accounts/conta/agenda/sessions/sessao', 'PATCH', 'Bearer token', { startsAt: '2026-10-04T15:00:00Z', durationMinutes: 30 }],
      ['/accounts/conta/agenda/sessions/sessao', 'DELETE', 'Bearer token', null],
    ])
  } finally { vi.unstubAllGlobals() }
})

it('agendar devolve o problema da API sem sessionId', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'agenda.slot_taken', params: {} }), { status: 409 })))
  try {
    expect(await agendarSessao('', 'conta', 'token', 'paciente', '2026-10-04T14:00:00Z', 50)).toMatchObject({ ok: false, code: 'agenda.slot_taken' })
  } finally { vi.unstubAllGlobals() }
})
