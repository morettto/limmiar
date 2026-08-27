import { webcrypto as limmiarWebcrypto, type CryptoKey } from '@limmiar/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { cadastrarVoz, obterCadastroVoz, removerCadastroVoz } from './voice-enrollment'
import { voiceDekAad, voiceEmbeddingAad } from './voice-crypto'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const ACCESS_TOKEN = 'access-token-abc'

async function makeKek(): Promise<CryptoKey> {
  return limmiarWebcrypto.importKek(new Uint8Array(32).fill(0x07))
}

// Pins the IVs webcrypto.generateWrappedDek()/encrypt() draw internally (one for the DEK
// wrap, one for the embedding ciphertext) via crypto.getRandomValues -- the only injection
// point reachable from apps/app. packages/crypto's own __setIvSourceForTests seam is
// deliberately NOT re-exported from the package barrel (see webcrypto.ts), and there is no
// hook at all for generateKey's CSPRNG-derived DEK key material, so a literal byte-for-byte
// KAT of the whole wrappedDek is out of reach from this layer. What *is* pinnable -- IV
// prefix and exact ciphertext length -- is asserted below, plus a round-trip decrypt through
// the real production primitives to prove the sealed bytes actually hold the embedding.
function stubDeterministicIvs(...ivs: Uint8Array[]): void {
  let call = 0
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    const iv = ivs[Math.min(call, ivs.length - 1)]
    call += 1
    array.set(iv)
    return array
  }) as typeof crypto.getRandomValues)
}

describe('cadastrarVoz', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('PUTs wrappedDek/sealedEmbedding whose IVs match the injected deterministic source (KAT)', async () => {
    const ivWrap = new Uint8Array(12).fill(0x01)
    const ivEnc = new Uint8Array(12).fill(0x02)
    stubDeterministicIvs(ivWrap, ivEnc)

    const kek = await makeKek()
    const embedding = [0.5, -0.25, 1.25]
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await cadastrarVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, kek, embedding)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`http://api.test/accounts/${ACCOUNT_ID}/voice-enrollment`)
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`)

    const body = JSON.parse(init.body as string) as { wrappedDek: string; sealedEmbedding: string }
    const wrappedDek = decodeBase64(body.wrappedDek)
    const sealedEmbedding = decodeBase64(body.sealedEmbedding)

    expect(wrappedDek.slice(0, 12)).toEqual(ivWrap)
    expect(sealedEmbedding.slice(0, 12)).toEqual(ivEnc)
    // Known lengths: iv(12) + AES-256 raw key(32) + GCM tag(16) = 60; iv(12) + 3 float32s(12) + tag(16) = 40.
    expect(wrappedDek.length).toBe(60)
    expect(sealedEmbedding.length).toBe(40)

    const dek = await limmiarWebcrypto.unwrapDek(kek, wrappedDek, voiceDekAad(ACCOUNT_ID))
    const plaintext = await limmiarWebcrypto.decrypt(dek, sealedEmbedding, voiceEmbeddingAad(ACCOUNT_ID))
    expect(Array.from(new Float32Array(plaintext.buffer, plaintext.byteOffset, embedding.length))).toEqual(
      Array.from(Float32Array.from(embedding)),
    )
  })

  // Proves the client-side half of "embedding de voz cifrado com a KEK, nunca em claro no
  // servidor": the serialized PUT body must be opaque base64, not the plaintext array.
  it('never sends the plaintext embedding array or its numeric values in the PUT body', async () => {
    const kek = await makeKek()
    const embedding = [0.123456, -9.87654, 42.0]
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await cadastrarVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, kek, embedding)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const rawBody = init.body as string
    const body = JSON.parse(rawBody) as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(['sealedEmbedding', 'wrappedDek'])
    for (const value of embedding) {
      expect(rawBody).not.toContain(String(value))
    }
    // Base64's alphabet (A-Z a-z 0-9 + /) has no '.' or '[' / ']' -- their absence proves
    // nothing that looks like a JSON number array made it into the serialized body.
    expect(rawBody).not.toMatch(/[.[\]]/)
  })

  it('maps a non-2xx PUT response to { ok: false, code } from the problem body', async () => {
    const kek = await makeKek()
    const problem = {
      type: 'about:blank',
      title: 'Embedding inválido',
      status: 422,
      code: 'voice-enrollment.invalid_embedding',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), { status: 422, headers: { 'Content-Type': 'application/problem+json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await cadastrarVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN, kek, [0.1])

    expect(result).toEqual({ ok: false, code: 'voice-enrollment.invalid_embedding', params: {} })
  })
})

describe('obterCadastroVoz', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs and decodes wrappedDek/sealedEmbedding on 200', async () => {
    const wrappedDek = new Uint8Array(60).fill(0x09)
    const sealedEmbedding = new Uint8Array(40).fill(0x0a)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ wrappedDek: encodeBase64(wrappedDek), sealedEmbedding: encodeBase64(sealedEmbedding) }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterCadastroVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: true, wrappedDek, sealedEmbedding })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/voice-enrollment`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('returns { ok: false, code } from the problem body on 404 (sem cadastro ainda)', async () => {
    const problem = { type: 'about:blank', title: 'x', status: 404, code: 'voice-enrollment.not_found', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(problem), { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await obterCadastroVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'voice-enrollment.not_found', params: {} })
  })
})

describe('removerCadastroVoz', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('DELETEs and maps 204 to { ok: true }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await removerCadastroVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(`http://api.test/accounts/${ACCOUNT_ID}/voice-enrollment`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    })
  })

  it('maps a non-2xx DELETE response to { ok: false, code } from the problem body', async () => {
    const problem = { type: 'about:blank', title: 'x', status: 403, code: 'voice-enrollment.forbidden', params: {} }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(problem), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await removerCadastroVoz('http://api.test', ACCOUNT_ID, ACCESS_TOKEN)

    expect(result).toEqual({ ok: false, code: 'voice-enrollment.forbidden', params: {} })
  })
})
