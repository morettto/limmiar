import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import type { Nota } from './nota'
import { digestNota } from './nota'
import { notaAssinaturaAad, notaParaEntrada, selarAssinatura } from './nota-crypto'

const NOTE_ID = '33333333-3333-3333-3333-333333333333'

async function makeDek(): Promise<CryptoKey> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  const { dek } = await limmiarWebcrypto.generateWrappedDek(kek, new Uint8Array())
  return dek
}

function notaFixture(overrides: Partial<Nota> = {}): Nota {
  return {
    id: NOTE_ID,
    patientId: '44444444-4444-4444-4444-444444444444',
    revisao: 1,
    frases: [
      { id: 'S-0', secao: 'S', texto: 'Paciente relata dor', ancoras: [{ inicioMs: 1000, fimMs: 2000 }] },
      { id: 'O-0', secao: 'O', texto: 'PA 120x80', ancoras: [] },
    ],
    ...overrides,
  }
}

describe('notaAssinaturaAad', () => {
  it('builds the locked AAD string as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(notaAssinaturaAad(NOTE_ID, 3))).toBe(`limmiar/note-signature/v1|${NOTE_ID}|3`)
  })
})

describe('selarAssinatura', () => {
  it('decrypts with the same DEK and AAD to exactly digestNota(nota)', async () => {
    const dek = await makeDek()
    const nota = notaFixture()

    const signature = await selarAssinatura(dek, NOTE_ID, nota)
    const opened = await limmiarWebcrypto.decrypt(dek, signature, notaAssinaturaAad(NOTE_ID, nota.revisao))

    expect(opened).toEqual(await digestNota(nota))
  })

  it('rejects decrypt when the AAD carries a different revisao', async () => {
    const dek = await makeDek()
    const nota = notaFixture()

    const signature = await selarAssinatura(dek, NOTE_ID, nota)

    await expect(
      limmiarWebcrypto.decrypt(dek, signature, notaAssinaturaAad(NOTE_ID, nota.revisao + 1)),
    ).rejects.toThrow()
  })
})

describe('notaParaEntrada', () => {
  it('serializes noteId, revisao and every frase (secao/texto/ancoras) as UTF-8 JSON', () => {
    const nota = notaFixture()

    const parsed = JSON.parse(new TextDecoder().decode(notaParaEntrada(nota))) as {
      tipo: string
      noteId: string
      revisao: number
      frases: { secao: string; texto: string; ancoras: { inicioMs: number; fimMs: number }[] }[]
    }

    expect(parsed).toEqual({
      tipo: 'nota',
      noteId: NOTE_ID,
      revisao: 1,
      frases: [
        { secao: 'S', texto: 'Paciente relata dor', ancoras: [{ inicioMs: 1000, fimMs: 2000 }] },
        { secao: 'O', texto: 'PA 120x80', ancoras: [] },
      ],
    })
  })
})
