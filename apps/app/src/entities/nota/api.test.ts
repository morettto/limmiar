import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../../shared/lib/base64'
import { assinarNota, obterAssinatura } from './api'

const ACCOUNT_ID = '55555555-5555-5555-5555-555555555555'
const ACCESS_TOKEN = 'access-token-xyz'
const NOTE_ID = '33333333-3333-3333-3333-333333333333'
const SIGNATURE = new Uint8Array([0x01, 0x02, 0x03, 0x04])
const SIGNATURE_BASE64 = encodeBase64(SIGNATURE)

describe('assinarNota', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { revisao, signature(base64) } with a bearer token and returns revisao + signedAt on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ revisao: 2, signedAt: '2026-08-27T10:00:00Z' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await assinarNota('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, NOTE_ID, {
      revisao: 2,
      signature: SIGNATURE,
    })

    expect(result).toEqual({ ok: true, noteId: NOTE_ID, revisao: 2, signedAt: '2026-08-27T10:00:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/notes/${NOTE_ID}/signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ revisao: 2, signature: SIGNATURE_BASE64 }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (already signed)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Note already signed',
      status: 409,
      code: 'notes.already_signed',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await assinarNota('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, NOTE_ID, {
      revisao: 2,
      signature: SIGNATURE,
    })

    expect(result).toEqual({ ok: false, code: 'notes.already_signed', params: {} })
  })
})

describe('obterAssinatura', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the signature endpoint with a bearer token and no body, returning revisao + signedAt on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ revisao: 2, signature: SIGNATURE_BASE64, signedAt: '2026-08-27T10:00:00Z' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterAssinatura('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, NOTE_ID)

    expect(result).toEqual({ ok: true, noteId: NOTE_ID, revisao: 2, signedAt: '2026-08-27T10:00:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/notes/${NOTE_ID}/signature`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (note not yet signed)', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Signature not found',
      status: 404,
      code: 'notes.signature_not_found',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterAssinatura('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, NOTE_ID)

    expect(result).toEqual({ ok: false, code: 'notes.signature_not_found', params: {} })
  })
})
