import { afterEach, describe, expect, it, vi } from 'vitest'
import { obterConsentimentos, registrarConsentimento } from './api'

const ACCOUNT_ID = '55555555-5555-5555-5555-555555555555'
const ACCESS_TOKEN = 'access-token-xyz'
const PATIENT_ID = '44444444-4444-4444-4444-444444444444'

describe('registrarConsentimento', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { purpose, decision } with a bearer token and returns the recorded decision on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ patientId: PATIENT_ID, purpose: 'gravacao', decision: 'revogado', recordedAt: '2026-08-28T10:00:00Z' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await registrarConsentimento(
      'http://api.test',
      ACCOUNT_ID,
      ACCESS_TOKEN,
      PATIENT_ID,
      { finalidade: 'gravacao', decisao: 'revogado' },
    )

    expect(result).toEqual({ ok: true, finalidade: 'gravacao', decisao: 'revogado', registradoEm: '2026-08-28T10:00:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}/consents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ purpose: 'gravacao', decision: 'revogado' }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 403 (not authorized)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Account is not authorized to record consent',
      status: 403,
      code: 'consent.not_authorized_to_record',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await registrarConsentimento(
      'http://api.test',
      ACCOUNT_ID,
      ACCESS_TOKEN,
      PATIENT_ID,
      { finalidade: 'analiseIa', decisao: 'concedido' },
    )

    expect(result).toEqual({ ok: false, code: 'consent.not_authorized_to_record', params: {} })
  })
})

describe('obterConsentimentos', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('obterConsentimentos devolve o estado das duas finalidades', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ gravacao: 'revogado', analiseIa: 'pendente' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterConsentimentos('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({ ok: true, consentimentos: { gravacao: 'revogado', analiseIa: 'pendente' } })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}/consents`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 401', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'auth.access_token_invalid',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterConsentimentos('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({ ok: false, code: 'auth.access_token_invalid', params: {} })
  })
})
