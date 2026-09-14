import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../../shared/lib/base64'
import {
  enviarItemPartilhado,
  gravarPreferenciasPartilha,
  listarItensPartilhados,
  obterPreferenciasPartilha,
} from './api'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PEER_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const ACCESS_TOKEN = 'access-token-abc'
const CIPHERTEXT = new Uint8Array(48).fill(9)
const WRAPPED_DEK = new Uint8Array(44).fill(2)

describe('enviarItemPartilhado', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { ciphertext } com bearer token e resolve { ok: true } no 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await enviarItemPartilhado('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PEER_ACCOUNT_ID, CIPHERTEXT)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/accounts/${ACCOUNT_ID}/links/${PEER_ACCOUNT_ID}/shared-items`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
        body: JSON.stringify({ ciphertext: encodeBase64(CIPHERTEXT) }),
      },
    )
  })

  it('devolve { ok: false, code, params } no 404 (sem vínculo nessa direção)', async () => {
    const problem = { type: 'about:blank', title: 'Not found', status: 404, code: 'link.not_found', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await enviarItemPartilhado('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PEER_ACCOUNT_ID, CIPHERTEXT)

    expect(result).toEqual({ ok: false, code: 'link.not_found', params: {} })
  })
})

describe('listarItensPartilhados', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs a lista com bearer token e decodifica cada ciphertext de base64', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ sharedAt: '2026-09-14T10:00:00Z', ciphertext: encodeBase64(CIPHERTEXT) }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listarItensPartilhados('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PEER_ACCOUNT_ID)

    expect(result).toEqual({ ok: true, itens: [{ partilhadoEm: '2026-09-14T10:00:00Z', ciphertext: CIPHERTEXT }] })
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/accounts/${ACCOUNT_ID}/links/${PEER_ACCOUNT_ID}/shared-items`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
    )
  })

  it('devolve { ok: false, code, params } no 404 (sem vínculo nessa direção)', async () => {
    const problem = { type: 'about:blank', title: 'Not found', status: 404, code: 'link.not_found', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listarItensPartilhados('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PEER_ACCOUNT_ID)

    expect(result).toEqual({ ok: false, code: 'link.not_found', params: {} })
  })
})

describe('obterPreferenciasPartilha', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs o blob com bearer token e decodifica wrappedDek/ciphertext de base64', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ version: 3, wrappedDek: encodeBase64(WRAPPED_DEK), ciphertext: encodeBase64(CIPHERTEXT) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterPreferenciasPartilha('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: true, versao: 3, wrappedDek: WRAPPED_DEK, ciphertext: CIPHERTEXT })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/sharing-preferences`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('devolve { ok: false, code, params } no 404 (nunca gravado)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      code: 'sharing.preferences_not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterPreferenciasPartilha('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'sharing.preferences_not_found', params: {} })
  })
})

describe('gravarPreferenciasPartilha', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs expectedVersion/wrappedDek/ciphertext e devolve a versão nova no 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await gravarPreferenciasPartilha('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      versaoEsperada: 0,
      wrappedDek: WRAPPED_DEK,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: true, versao: 1 })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/sharing-preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({
        expectedVersion: 0,
        wrappedDek: encodeBase64(WRAPPED_DEK),
        ciphertext: encodeBase64(CIPHERTEXT),
      }),
    })
  })

  it('devolve { ok: false, code, params } no 409 (versão desatualizada)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'sharing.version_conflict',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await gravarPreferenciasPartilha('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      versaoEsperada: 0,
      wrappedDek: WRAPPED_DEK,
      ciphertext: CIPHERTEXT,
    })

    expect(result).toEqual({ ok: false, code: 'sharing.version_conflict', params: {} })
  })
})
