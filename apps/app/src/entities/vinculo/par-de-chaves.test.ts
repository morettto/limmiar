import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPair, webcrypto } from '@limmiar/crypto'
import { encodeBase64 } from '../../shared/lib/base64'
import * as vinculoApi from './api'
import { garantirParDeChaves } from './par-de-chaves'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, obterParDeChaves: vi.fn(), publicarParDeChaves: vi.fn() }
})

const obterParDeChavesMock = vi.mocked(vinculoApi.obterParDeChaves)
const publicarParDeChavesMock = vi.mocked(vinculoApi.publicarParDeChaves)

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const ACCESS_TOKEN = 'access-token-abc'
const AAD = new TextEncoder().encode(`limmiar/chave-x25519/v1|${ACCOUNT_ID}`)

async function importTestKek(): Promise<import('@limmiar/crypto').CryptoKey> {
  return webcrypto.importKek(new Uint8Array(32).fill(7))
}

describe('garantirParDeChaves', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('when the server already has a published pair (200), unwraps and decrypts it without publishing anything', async () => {
    const kek = await importTestKek()
    const keyPair = generateKeyPair()
    const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, AAD)
    const sealedPrivateKey = await webcrypto.encrypt(dek, new Uint8Array(keyPair.privateKey), AAD)
    obterParDeChavesMock.mockResolvedValue({
      ok: true,
      par: { publicKey: keyPair.publicKey, wrappedDek: wrapped, sealedPrivateKey },
    })

    const result = await garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(result).toEqual({ publicKey: keyPair.publicKey, privateKey: keyPair.privateKey })
    expect(publicarParDeChavesMock).not.toHaveBeenCalled()
  })

  it('throws on any GET failure other than key_pair.not_found (e.g. 401/403 mean wrong session, not "no pair")', async () => {
    const kek = await importTestKek()
    obterParDeChavesMock.mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    await expect(
      garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }),
    ).rejects.toThrow('auth.forbidden')
    expect(publicarParDeChavesMock).not.toHaveBeenCalled()
  })

  it('throws on any PUT failure other than key_pair.public_key_conflict', async () => {
    const kek = await importTestKek()
    obterParDeChavesMock.mockResolvedValue({ ok: false, code: 'key_pair.not_found', params: {} })
    publicarParDeChavesMock.mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    await expect(
      garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }),
    ).rejects.toThrow('auth.forbidden')
  })

  it('throws if re-reading the pair after a 409 conflict fails too', async () => {
    const kek = await importTestKek()
    obterParDeChavesMock
      .mockResolvedValueOnce({ ok: false, code: 'key_pair.not_found', params: {} })
      .mockResolvedValueOnce({ ok: false, code: 'auth.forbidden', params: {} })
    publicarParDeChavesMock.mockResolvedValue({ ok: false, code: 'key_pair.public_key_conflict', params: {} })

    await expect(
      garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }),
    ).rejects.toThrow('auth.forbidden')
  })

  it('when the server has no pair yet (404), generates one, seals the private key and publishes it', async () => {
    const kek = await importTestKek()
    obterParDeChavesMock.mockResolvedValue({ ok: false, code: 'key_pair.not_found', params: {} })
    publicarParDeChavesMock.mockResolvedValue({ ok: true })

    const result = await garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(publicarParDeChavesMock).toHaveBeenCalledTimes(1)
    const [, , , publishedPar] = publicarParDeChavesMock.mock.calls[0]!
    expect(publishedPar.publicKey).toEqual(result.publicKey)

    // Round-trips the sealed envelope this call actually sent, proving it decrypts back to the
    // same private key returned -- not a value the test recomputed independently.
    const dek = await webcrypto.unwrapDek(kek, publishedPar.wrappedDek, AAD)
    const roundTrippedPrivateKey = await webcrypto.decrypt(dek, publishedPar.sealedPrivateKey, AAD)
    expect(roundTrippedPrivateKey).toEqual(result.privateKey)
  })

  it('when publishing loses a race (409), adopts the server pair instead of the one generated locally', async () => {
    const kek = await importTestKek()
    const serverKeyPair = generateKeyPair()
    const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, AAD)
    const sealedPrivateKey = await webcrypto.encrypt(dek, new Uint8Array(serverKeyPair.privateKey), AAD)
    obterParDeChavesMock
      .mockResolvedValueOnce({ ok: false, code: 'key_pair.not_found', params: {} })
      .mockResolvedValueOnce({
        ok: true,
        par: { publicKey: serverKeyPair.publicKey, wrappedDek: wrapped, sealedPrivateKey },
      })
    publicarParDeChavesMock.mockResolvedValue({ ok: false, code: 'key_pair.public_key_conflict', params: {} })

    const result = await garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(result).toEqual({ publicKey: serverKeyPair.publicKey, privateKey: serverKeyPair.privateKey })
    expect(obterParDeChavesMock).toHaveBeenCalledTimes(2)
  })

  it('never sends the raw private key bytes in any request body, in either the 200 or the 404 branch', async () => {
    const kek = await importTestKek()

    const existingKeyPair = generateKeyPair()
    const { dek: existingDek, wrapped: existingWrapped } = await webcrypto.generateWrappedDek(kek, AAD)
    const existingSealed = await webcrypto.encrypt(existingDek, new Uint8Array(existingKeyPair.privateKey), AAD)
    obterParDeChavesMock.mockResolvedValueOnce({
      ok: true,
      par: { publicKey: existingKeyPair.publicKey, wrappedDek: existingWrapped, sealedPrivateKey: existingSealed },
    })
    const readResult = await garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    obterParDeChavesMock.mockResolvedValueOnce({ ok: false, code: 'key_pair.not_found', params: {} })
    publicarParDeChavesMock.mockResolvedValue({ ok: true })
    const generatedResult = await garantirParDeChaves({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    const privateKeysAsBase64 = [readResult.privateKey, generatedResult.privateKey].map(encodeBase64)
    const publishedBodies = publicarParDeChavesMock.mock.calls.map((call) => JSON.stringify(call[3]))
    for (const body of publishedBodies) {
      for (const privateKeyBase64 of privateKeysAsBase64) {
        expect(body.includes(privateKeyBase64)).toBe(false)
      }
    }
  })
})
