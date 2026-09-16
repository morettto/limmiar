import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../../shared/lib/base64'
import {
  criarConviteVinculo,
  desvincular,
  listarVinculos,
  obterParDeChaves,
  publicarParDeChaves,
  resgatarConviteVinculo,
} from './api'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PATIENT_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const ACCESS_TOKEN = 'access-token-abc'
const INVITE_CODE = 'test-code'
const PATIENT_ID = '33333333-3333-3333-3333-333333333333'
const PUBLIC_KEY = new Uint8Array(32).fill(1)
const WRAPPED_DEK = new Uint8Array(44).fill(2)
const SEALED_PRIVATE_KEY = new Uint8Array(60).fill(3)
const PEER_PUBLIC_KEY = new Uint8Array(32).fill(4)

describe('publicarParDeChaves', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs the sealed envelope with a bearer token and resolves { ok: true } on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await publicarParDeChaves('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      publicKey: PUBLIC_KEY,
      wrappedDek: WRAPPED_DEK,
      sealedPrivateKey: SEALED_PRIVATE_KEY,
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/key-pair`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({
        publicKey: encodeBase64(PUBLIC_KEY),
        wrappedDek: encodeBase64(WRAPPED_DEK),
        sealedPrivateKey: encodeBase64(SEALED_PRIVATE_KEY),
      }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (public key conflict)', async () => {
    const problem = { type: 'about:blank', title: 'Conflict', status: 409, code: 'key_pair.public_key_conflict', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await publicarParDeChaves('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, {
      publicKey: PUBLIC_KEY,
      wrappedDek: WRAPPED_DEK,
      sealedPrivateKey: SEALED_PRIVATE_KEY,
    })

    expect(result).toEqual({ ok: false, code: 'key_pair.public_key_conflict', params: {} })
  })
})

describe('obterParDeChaves', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the sealed envelope with a bearer token and decodes it from base64 on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          publicKey: encodeBase64(PUBLIC_KEY),
          wrappedDek: encodeBase64(WRAPPED_DEK),
          sealedPrivateKey: encodeBase64(SEALED_PRIVATE_KEY),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterParDeChaves('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({
      ok: true,
      par: { publicKey: PUBLIC_KEY, wrappedDek: WRAPPED_DEK, sealedPrivateKey: SEALED_PRIVATE_KEY },
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/key-pair`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (no key pair published yet)', async () => {
    const problem = { type: 'about:blank', title: 'Not found', status: 404, code: 'key_pair.not_found', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterParDeChaves('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'key_pair.not_found', params: {} })
  })
})

describe('criarConviteVinculo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs with no body and a bearer token, returning codigo + expiraEm on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: INVITE_CODE, expiresAt: '2026-09-21T12:00:00Z' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await criarConviteVinculo('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({ ok: true, codigo: INVITE_CODE, expiraEm: '2026-09-21T12:00:00Z' })
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/accounts/${ACCOUNT_ID}/patients/${PATIENT_ID}/link-invites`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` }, body: undefined },
    )
  })

  it('returns { ok: false, code, params } parsed from problem+json on 403 (not an active professional)', async () => {
    const problem = { type: 'about:blank', title: 'Forbidden', status: 403, code: 'auth.forbidden', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await criarConviteVinculo('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)

    expect(result).toEqual({ ok: false, code: 'auth.forbidden', params: {} })
  })
})

describe('resgatarConviteVinculo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs { code } with a bearer token and returns the Vinculo on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          professionalAccountId: ACCOUNT_ID,
          patientAccountId: PATIENT_ACCOUNT_ID,
          patientId: PATIENT_ID,
          linkedAt: '2026-09-21T12:00:00Z',
          peerPublicKey: encodeBase64(PEER_PUBLIC_KEY),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await resgatarConviteVinculo('http://api.test', PATIENT_ACCOUNT_ID, ACCESS_TOKEN, INVITE_CODE)

    expect(result).toEqual({
      ok: true,
      vinculo: {
        profissionalAccountId: ACCOUNT_ID,
        pacienteAccountId: PATIENT_ACCOUNT_ID,
        patientId: PATIENT_ID,
        vinculadoEm: '2026-09-21T12:00:00Z',
        chavePublicaDoPar: PEER_PUBLIC_KEY,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${PATIENT_ACCOUNT_ID}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ code: INVITE_CODE }),
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (invite not found, expired or already used)', async () => {
    const problem = { type: 'about:blank', title: 'Not found', status: 404, code: 'link.invite_not_found', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await resgatarConviteVinculo('http://api.test', PATIENT_ACCOUNT_ID, ACCESS_TOKEN, 'INVALIDO0000')

    expect(result).toEqual({ ok: false, code: 'link.invite_not_found', params: {} })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 409 (already linked)', async () => {
    const problem = { type: 'about:blank', title: 'Conflict', status: 409, code: 'link.already_linked', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 409, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await resgatarConviteVinculo('http://api.test', PATIENT_ACCOUNT_ID, ACCESS_TOKEN, INVITE_CODE)

    expect(result).toEqual({ ok: false, code: 'link.already_linked', params: {} })
  })
})

describe('listarVinculos', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs the list with a bearer token and maps each Vinculo, keeping a null peer key null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            professionalAccountId: ACCOUNT_ID,
            patientAccountId: PATIENT_ACCOUNT_ID,
            patientId: PATIENT_ID,
            linkedAt: '2026-09-21T12:00:00Z',
            peerPublicKey: encodeBase64(PEER_PUBLIC_KEY),
          },
          {
            professionalAccountId: ACCOUNT_ID,
            patientAccountId: PATIENT_ACCOUNT_ID,
            patientId: PATIENT_ID,
            linkedAt: '2026-09-22T12:00:00Z',
            peerPublicKey: null,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listarVinculos('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({
      ok: true,
      vinculos: [
        {
          profissionalAccountId: ACCOUNT_ID,
          pacienteAccountId: PATIENT_ACCOUNT_ID,
          patientId: PATIENT_ID,
          vinculadoEm: '2026-09-21T12:00:00Z',
          chavePublicaDoPar: PEER_PUBLIC_KEY,
        },
        {
          profissionalAccountId: ACCOUNT_ID,
          pacienteAccountId: PATIENT_ACCOUNT_ID,
          patientId: PATIENT_ID,
          vinculadoEm: '2026-09-22T12:00:00Z',
          chavePublicaDoPar: null,
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/links`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 403 (token de outra conta)', async () => {
    const problem = { type: 'about:blank', title: 'Forbidden', status: 403, code: 'auth.forbidden', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await listarVinculos('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'auth.forbidden', params: {} })
  })
})

describe('desvincular', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('DELETEs the link with a bearer token and resolves { ok: true } on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await desvincular('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ACCOUNT_ID)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/links/${PATIENT_ACCOUNT_ID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code, params } parsed from problem+json on 404 (no link between the two accounts)', async () => {
    const problem = { type: 'about:blank', title: 'Not found', status: 404, code: 'link.not_found', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await desvincular('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ACCOUNT_ID)

    expect(result).toEqual({ ok: false, code: 'link.not_found', params: {} })
  })
})
