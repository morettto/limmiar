import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../../shared/lib/base64'
import { comPartilha, type EstadoPartilha } from './partilha'
import { RollbackDePreferencias, definirPartilha, lerEstadoPartilha } from './preferencias'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const BASE_URL = 'http://api.test'
const ACCESS_TOKEN = 'access-token-abc'
const ULTIMA_VISTA_KEY = `limmiar:partilha-versao:${ACCOUNT_ID}`
const CHAVE = '22222222-2222-2222-2222-222222222222|2026-09-14T10:00:00Z'

async function criarKek(): Promise<CryptoKey> {
  return webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
}

function preferenciasAad(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`limmiar/partilha-estado/v1|${ACCOUNT_ID}`)
}

async function cifrarBlob(kek: CryptoKey, versao: number, estado: EstadoPartilha) {
  const aad = preferenciasAad()
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, aad)
  const plaintext = new TextEncoder().encode(JSON.stringify({ versao, estado }))
  const ciphertext = await webcrypto.encrypt(dek, plaintext, aad)
  return { wrappedDek: wrapped, ciphertext }
}

function respostaJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function respostaProblema(status: number, code: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, params: {} }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

describe('lerEstadoPartilha', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('404 (sharing.preferences_not_found) devolve estado vazio com versão 0', async () => {
    const kek = await criarKek()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaProblema(404, 'sharing.preferences_not_found')),
    )

    const resultado = await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(resultado).toEqual({ versao: 0, estado: {} })
  })

  it('200 decifra o blob e sobe a última versão vista', async () => {
    const kek = await criarKek()
    const estado = comPartilha({}, CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 1, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson({
          version: 1,
          wrappedDek: encodeBase64(wrappedDek),
          ciphertext: encodeBase64(ciphertext),
        }),
      ),
    )

    const resultado = await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(resultado).toEqual({ versao: 1, estado })
    expect(window.localStorage.getItem(ULTIMA_VISTA_KEY)).toBe('1')
  })

  it('ler duas vezes seguidas com a mesma versão não regride a última vista', async () => {
    const kek = await criarKek()
    const estado = comPartilha({}, CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 1, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          respostaJson({
            version: 1,
            wrappedDek: encodeBase64(wrappedDek),
            ciphertext: encodeBase64(ciphertext),
          }),
        ),
      ),
    )

    await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })
    const segunda = await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(segunda).toEqual({ versao: 1, estado })
    expect(window.localStorage.getItem(ULTIMA_VISTA_KEY)).toBe('1')
  })

  it('versão interna diferente da versão do fio lança RollbackDePreferencias', async () => {
    const kek = await criarKek()
    const estado = comPartilha({}, CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 2, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson({
          version: 5,
          wrappedDek: encodeBase64(wrappedDek),
          ciphertext: encodeBase64(ciphertext),
        }),
      ),
    )

    const erro = await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }).catch(
      (e: unknown) => e,
    )
    expect(erro).toBeInstanceOf(RollbackDePreferencias)
    expect((erro as Error).message).toContain('a versão autenticada diverge da versão do fio')
  })

  it('blob mais antigo do que a última versão vista lança RollbackDePreferencias', async () => {
    const kek = await criarKek()
    window.localStorage.setItem(ULTIMA_VISTA_KEY, '5')
    const estado = comPartilha({}, CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 2, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson({
          version: 2,
          wrappedDek: encodeBase64(wrappedDek),
          ciphertext: encodeBase64(ciphertext),
        }),
      ),
    )

    const erro = await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }).catch(
      (e: unknown) => e,
    )
    expect(erro).toBeInstanceOf(RollbackDePreferencias)
    expect((erro as Error).message).toContain('o servidor devolveu um blob mais antigo do que o já visto')
  })

  it('falha de rede/servidor (não 404) lança em vez de tratar como estado vazio', async () => {
    const kek = await criarKek()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaProblema(403, 'auth.forbidden')))

    await expect(
      lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }),
    ).rejects.toThrow('falha ao ler preferências (auth.forbidden)')
  })

  it('ler a mesma versão duas vezes não escreve em localStorage na segunda leitura', async () => {
    const kek = await criarKek()
    const estado = comPartilha({}, CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 1, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          respostaJson({ version: 1, wrappedDek: encodeBase64(wrappedDek), ciphertext: encodeBase64(ciphertext) }),
        ),
      ),
    )

    await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })

  it('valor corrompido em localStorage não silencia a guarda de rollback para sempre', async () => {
    const kek = await criarKek()
    window.localStorage.setItem(ULTIMA_VISTA_KEY, 'abc')
    const estado = comPartilha({}, CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 1, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson({ version: 1, wrappedDek: encodeBase64(wrappedDek), ciphertext: encodeBase64(ciphertext) }),
      ),
    )

    await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek })

    expect(window.localStorage.getItem(ULTIMA_VISTA_KEY)).toBe('1')

    const { wrappedDek: wrappedDek2, ciphertext: ciphertext2 } = await cifrarBlob(kek, 0, estado)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson({ version: 0, wrappedDek: encodeBase64(wrappedDek2), ciphertext: encodeBase64(ciphertext2) }),
      ),
    )

    const erro = await lerEstadoPartilha({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek }).catch(
      (e: unknown) => e,
    )
    expect(erro).toBeInstanceOf(RollbackDePreferencias)
  })
})

describe('definirPartilha', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lê, aplica a mudança e grava com expectedVersion = versão lida', async () => {
    const kek = await criarKek()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaProblema(404, 'sharing.preferences_not_found'))
      .mockResolvedValueOnce(respostaJson({ version: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await definirPartilha({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      kek,
      chave: CHAVE,
      tipo: 'checkin',
      ativa: true,
    })

    expect(resultado).toEqual(comPartilha({}, CHAVE, 'checkin', true))
    const putCall = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(putCall[0]).toBe(`${BASE_URL}/accounts/${ACCOUNT_ID}/sharing-preferences`)
    const putBody = JSON.parse(putCall[1].body as string) as { expectedVersion: number }
    expect(putBody.expectedVersion).toBe(0)
  })

  it('409 relê, reaplica a mesma mudança e tenta uma vez mais', async () => {
    const kek = await criarKek()
    const OUTRA_CHAVE = 'outra-profissional|2026-09-14T10:00:00Z'
    const estadoServidor = comPartilha({}, OUTRA_CHAVE, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlob(kek, 1, estadoServidor)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaProblema(404, 'sharing.preferences_not_found'))
      .mockResolvedValueOnce(respostaProblema(409, 'sharing.version_conflict'))
      .mockResolvedValueOnce(
        respostaJson({
          version: 1,
          wrappedDek: encodeBase64(wrappedDek),
          ciphertext: encodeBase64(ciphertext),
        }),
      )
      .mockResolvedValueOnce(respostaJson({ version: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await definirPartilha({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      kek,
      chave: CHAVE,
      tipo: 'checkin',
      ativa: true,
    })

    expect(resultado).toEqual(comPartilha(estadoServidor, CHAVE, 'checkin', true))
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const segundoPut = fetchMock.mock.calls[3] as [string, RequestInit]
    const putBody = JSON.parse(segundoPut[1].body as string) as { expectedVersion: number }
    expect(putBody.expectedVersion).toBe(1)
  })

  it('um segundo 409 seguido lança', async () => {
    const kek = await criarKek()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaProblema(404, 'sharing.preferences_not_found'))
      .mockResolvedValueOnce(respostaProblema(409, 'sharing.version_conflict'))
      .mockResolvedValueOnce(respostaProblema(404, 'sharing.preferences_not_found'))
      .mockResolvedValueOnce(respostaProblema(409, 'sharing.version_conflict'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      definirPartilha({
        baseUrl: BASE_URL,
        accountId: ACCOUNT_ID,
        accessToken: ACCESS_TOKEN,
        kek,
        chave: CHAVE,
        tipo: 'checkin',
        ativa: true,
      }),
    ).rejects.toThrow('conflito de versão persistente (sharing.version_conflict)')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('uma falha de gravação que não é 409 lança sem tentar outra vez', async () => {
    const kek = await criarKek()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaProblema(404, 'sharing.preferences_not_found'))
      .mockResolvedValueOnce(respostaProblema(400, 'validation.invalid_field'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      definirPartilha({
        baseUrl: BASE_URL,
        accountId: ACCOUNT_ID,
        accessToken: ACCESS_TOKEN,
        kek,
        chave: CHAVE,
        tipo: 'checkin',
        ativa: true,
      }),
    ).rejects.toThrow('falha ao gravar (validation.invalid_field)')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
