import { generateKeyPair, webcrypto } from '@limmiar/crypto'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import type { Vinculo } from '../vinculo/api'
import { decifrarItem } from './cifra'
import { definirPartilha } from './preferencias'
import { partilharCheckIn } from './partilhar-checkin'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PROFISSIONAL_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const BASE_URL = 'http://api.test'
const ACCESS_TOKEN = 'access-token-abc'

interface PreferenciasBlob {
  version: number
  wrappedDek: string
  ciphertext: string
}

interface FakeServer {
  preferencias: PreferenciasBlob | undefined
  historico: PreferenciasBlob[]
  itensPartilhados: string[]
  keyPair: { publicKey: string; wrappedDek: string; sealedPrivateKey: string } | undefined
}

function novoServidor(): FakeServer {
  return { preferencias: undefined, historico: [], itensPartilhados: [], keyPair: undefined }
}

function criarVinculo(profissional: { publicKey: Uint8Array }): Vinculo {
  return {
    profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
    pacienteAccountId: ACCOUNT_ID,
    patientId: 'patient-1',
    vinculadoEm: '2026-09-14T10:00:00Z',
    chavePublicaDoPar: profissional.publicKey,
  }
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

function instalarFetchFalso(servidor: FakeServer, profissional: { publicKey: Uint8Array }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
        return Promise.resolve(
          servidor.keyPair === undefined ? respostaProblema(404, 'key_pair.not_found') : respostaJson(servidor.keyPair),
        )
      }
      if (url.endsWith('/key-pair') && init?.method === 'PUT') {
        servidor.keyPair = JSON.parse(init.body as string) as FakeServer['keyPair']
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.endsWith('/sharing-preferences') && init?.method === undefined) {
        return Promise.resolve(
          servidor.preferencias === undefined
            ? respostaProblema(404, 'sharing.preferences_not_found')
            : respostaJson(servidor.preferencias),
        )
      }
      if (url.endsWith('/sharing-preferences') && init?.method === 'PUT') {
        const body = JSON.parse(init.body as string) as { expectedVersion: number; wrappedDek: string; ciphertext: string }
        const versaoAtual = servidor.preferencias?.version ?? 0
        if (body.expectedVersion !== versaoAtual) {
          return Promise.resolve(respostaProblema(409, 'sharing.version_conflict'))
        }
        const novoBlob: PreferenciasBlob = {
          version: versaoAtual + 1,
          wrappedDek: body.wrappedDek,
          ciphertext: body.ciphertext,
        }
        servidor.preferencias = novoBlob
        servidor.historico.push(novoBlob)
        return Promise.resolve(respostaJson({ version: novoBlob.version }))
      }
      if (url.includes('/shared-items') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { ciphertext: string }
        servidor.itensPartilhados.push(body.ciphertext)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      throw new Error(`chamada inesperada: ${init?.method ?? 'GET'} ${url}`)
    }),
  )
}

const COMANDO = fc.constantFrom('ativar', 'revogar', 'gravar', 'repor')

describe('partilharCheckIn — sequência de ativar/revogar/gravar/repor', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST só acontece com o toggle ativo na última versão validada; um blob reposto trava a partilha; todo POST decifra com a privada da Marta', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(COMANDO, { minLength: 1, maxLength: 10 }), async (comandos) => {
        window.localStorage.clear()
        const kek = await webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
        const profissional = generateKeyPair()
        const vinculo = criarVinculo(profissional)
        const servidor = novoServidor()
        instalarFetchFalso(servidor, profissional)

        let toggleAtivoEsperado = false
        let travado = false
        let dia = 0

        for (const comando of comandos) {
          if (travado) {
            await expect(
              comando === 'gravar'
                ? partilharCheckIn({
                    baseUrl: BASE_URL,
                    accountId: ACCOUNT_ID,
                    accessToken: ACCESS_TOKEN,
                    kek,
                    checkin: { dia: `dia-${dia}`, sono: 3, ansiedade: 3, frase: null },
                  })
                : definirPartilha({
                    baseUrl: BASE_URL,
                    accountId: ACCOUNT_ID,
                    accessToken: ACCESS_TOKEN,
                    kek,
                    vinculo,
                    tipo: 'checkin',
                    ativa: comando === 'ativar',
                  }),
            ).rejects.toThrow()
            continue
          }

          if (comando === 'ativar' || comando === 'revogar') {
            await definirPartilha({
              baseUrl: BASE_URL,
              accountId: ACCOUNT_ID,
              accessToken: ACCESS_TOKEN,
              kek,
              vinculo,
              tipo: 'checkin',
              ativa: comando === 'ativar',
            })
            toggleAtivoEsperado = comando === 'ativar'
            continue
          }

          if (comando === 'gravar') {
            dia += 1
            const checkin = { dia: `dia-${dia}`, sono: 3 as const, ansiedade: 3 as const, frase: null }
            const antes = servidor.itensPartilhados.length

            const resultado = await partilharCheckIn({
              baseUrl: BASE_URL,
              accountId: ACCOUNT_ID,
              accessToken: ACCESS_TOKEN,
              kek,
              checkin,
            })

            if (toggleAtivoEsperado) {
              expect(resultado.partilhadoCom).toEqual([PROFISSIONAL_ACCOUNT_ID])
              expect(servidor.itensPartilhados.length).toBe(antes + 1)

              const ciphertextBase64 = servidor.itensPartilhados.at(-1) as string
              const ciphertext = decodeBase64(ciphertextBase64)
              const publicaPaciente = decodeBase64((servidor.keyPair as NonNullable<FakeServer['keyPair']>).publicKey)
              const decifrado = decifrarItem({
                privadaProfissional: profissional.privateKey,
                publicaPaciente,
                pacienteAccountId: ACCOUNT_ID,
                profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
                ciphertext,
              })
              expect(decifrado).toEqual({ tipo: 'checkin', checkin })

              const bytesLatinos = String.fromCharCode(...ciphertext)
              expect(bytesLatinos).not.toContain(checkin.dia)
            } else {
              expect(resultado.partilhadoCom).toEqual([])
              expect(servidor.itensPartilhados.length).toBe(antes)
            }
            continue
          }

          // comando === 'repor': recua para um blob estritamente mais antigo do que o que este
          // dispositivo já validou, se existir; menos do que 2 blobs no histórico é um no-op.
          if (servidor.historico.length >= 2) {
            servidor.preferencias = servidor.historico.at(-2)
            travado = true
          }
        }
      }),
      { numRuns: 30 },
    )
  })
})
