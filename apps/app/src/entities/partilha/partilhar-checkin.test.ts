import { generateKeyPair, webcrypto, type CryptoKey } from '@limmiar/crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeBase64 } from '../../shared/lib/base64'
import { decifrarItem } from './cifra'
import { comPartilha, type EstadoPartilha } from './partilha'
import { partilharCheckIn } from './partilhar-checkin'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PROFISSIONAL_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const BASE_URL = 'http://api.test'
const ACCESS_TOKEN = 'access-token-abc'
const CHECKIN = { dia: '2026-09-14', sono: 3 as const, ansiedade: 2 as const, frase: null }

async function criarKek(): Promise<CryptoKey> {
  return webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
}

function preferenciasAad(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`limmiar/partilha-estado/v1|${ACCOUNT_ID}`)
}

async function cifrarBlobPreferencias(kek: CryptoKey, versao: number, estado: EstadoPartilha) {
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

function respostaVazia(status = 204): Response {
  return new Response(null, { status })
}

describe('partilharCheckIn', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('zero destinatários: nunca pede o key-pair nem cifra, e devolve partilhadoCom: []', async () => {
    const kek = await criarKek()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/sharing-preferences')) {
        return Promise.resolve(respostaProblema(404, 'sharing.preferences_not_found'))
      }
      if (url.endsWith('/links')) {
        return Promise.resolve(respostaJson([]))
      }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await partilharCheckIn({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      kek,
      checkin: CHECKIN,
    })

    expect(resultado).toEqual({ partilhadoCom: [] })
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/key-pair'), expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/shared-items'), expect.anything())
  })

  it('um destinatário ativo: cifra para a pública dela e a Marta decifra o mesmo check-in', async () => {
    const kek = await criarKek()
    const profissional = generateKeyPair()

    const vinculoAtivo = {
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      pacienteAccountId: ACCOUNT_ID,
      patientId: 'patient-1',
      vinculadoEm: '2026-09-14T10:00:00Z',
      chavePublicaDoPar: profissional.publicKey,
    }
    const estado = comPartilha({}, vinculoAtivo, 'checkin', true)
    const { wrappedDek, ciphertext } = await cifrarBlobPreferencias(kek, 1, estado)

    let publicaPacientePublicada: Uint8Array | null = null
    let ciphertextEnviado: Uint8Array | null = null

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/sharing-preferences')) {
        return Promise.resolve(
          respostaJson({ version: 1, wrappedDek: encodeBase64(wrappedDek), ciphertext: encodeBase64(ciphertext) }),
        )
      }
      if (url.endsWith('/links')) {
        return Promise.resolve(
          respostaJson([
            {
              professionalAccountId: PROFISSIONAL_ACCOUNT_ID,
              patientAccountId: ACCOUNT_ID,
              patientId: 'patient-1',
              linkedAt: '2026-09-14T10:00:00Z',
              peerPublicKey: encodeBase64(profissional.publicKey),
            },
          ]),
        )
      }
      if (url.endsWith('/key-pair') && init?.method === undefined) {
        return Promise.resolve(respostaProblema(404, 'key_pair.not_found'))
      }
      if (url.endsWith('/key-pair') && init?.method === 'PUT') {
        const body = JSON.parse(init.body as string) as { publicKey: string }
        publicaPacientePublicada = Uint8Array.from(atob(body.publicKey), (c) => c.charCodeAt(0))
        return Promise.resolve(respostaVazia(204))
      }
      if (url.includes('/shared-items')) {
        expect(url).toContain(PROFISSIONAL_ACCOUNT_ID)
        const body = JSON.parse((init?.body as string) ?? '{}') as { ciphertext: string }
        ciphertextEnviado = Uint8Array.from(atob(body.ciphertext), (c) => c.charCodeAt(0))
        return Promise.resolve(respostaVazia(204))
      }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await partilharCheckIn({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      kek,
      checkin: CHECKIN,
    })

    expect(resultado).toEqual({ partilhadoCom: [PROFISSIONAL_ACCOUNT_ID] })
    if (publicaPacientePublicada === null || ciphertextEnviado === null) {
      throw new Error('teste: o mock não capturou a pública publicada ou o ciphertext enviado')
    }
    const decifrado = decifrarItem({
      privadaProfissional: profissional.privateKey,
      publicaPaciente: publicaPacientePublicada,
      pacienteAccountId: ACCOUNT_ID,
      profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
      ciphertext: ciphertextEnviado,
    })
    expect(decifrado).toEqual({ tipo: 'checkin', checkin: CHECKIN })
  })

  it('falha a ler as preferências: lança e não partilha', async () => {
    const kek = await criarKek()
    const fetchMock = vi.fn().mockResolvedValue(respostaProblema(403, 'auth.forbidden'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      partilharCheckIn({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek, checkin: CHECKIN }),
    ).rejects.toThrow('lerEstadoPartilha: falha ao ler preferências (auth.forbidden)')
  })

  it('falha ao enviar o item partilhado: lança', async () => {
    const kek = await criarKek()
    const profissional = generateKeyPair()
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/sharing-preferences')) {
        const estado = comPartilha(
          {},
          {
            profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
            pacienteAccountId: ACCOUNT_ID,
            patientId: 'patient-1',
            vinculadoEm: '2026-09-14T10:00:00Z',
            chavePublicaDoPar: profissional.publicKey,
          },
          'checkin',
          true,
        )
        return (async () => {
          const { wrappedDek, ciphertext } = await cifrarBlobPreferencias(kek, 1, estado)
          return respostaJson({ version: 1, wrappedDek: encodeBase64(wrappedDek), ciphertext: encodeBase64(ciphertext) })
        })()
      }
      if (url.endsWith('/links')) {
        return Promise.resolve(
          respostaJson([
            {
              professionalAccountId: PROFISSIONAL_ACCOUNT_ID,
              patientAccountId: ACCOUNT_ID,
              patientId: 'patient-1',
              linkedAt: '2026-09-14T10:00:00Z',
              peerPublicKey: encodeBase64(profissional.publicKey),
            },
          ]),
        )
      }
      if (url.endsWith('/key-pair') && init?.method === undefined) {
        return Promise.resolve(respostaProblema(404, 'key_pair.not_found'))
      }
      if (url.endsWith('/key-pair') && init?.method === 'PUT') {
        return Promise.resolve(respostaVazia(204))
      }
      if (url.includes('/shared-items')) {
        return Promise.resolve(respostaProblema(404, 'link.not_found'))
      }
      throw new Error(`chamada inesperada: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      partilharCheckIn({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek, checkin: CHECKIN }),
    ).rejects.toThrow('partilharCheckIn: falha ao enviar item partilhado (link.not_found)')
  })

  it('falha ao listar vínculos: lança', async () => {
    const kek = await criarKek()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/sharing-preferences')) {
        return Promise.resolve(respostaProblema(404, 'sharing.preferences_not_found'))
      }
      return Promise.resolve(respostaProblema(403, 'auth.forbidden'))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      partilharCheckIn({ baseUrl: BASE_URL, accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN, kek, checkin: CHECKIN }),
    ).rejects.toThrow('partilharCheckIn: falha ao listar vínculos (auth.forbidden)')
  })
})
