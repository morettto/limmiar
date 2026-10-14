import { webcrypto as limmiarWebcrypto, type CryptoKey } from '@limmiar/crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { abrirEmbedding, selarEmbedding, voiceDekAad, voiceEmbeddingAad } from './voice-crypto'
import { embeddingValido, MODELO_VOZ } from './modelo'
import { dynamicActivate } from '../../shared/i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

describe('voiceDekAad / voiceEmbeddingAad', () => {
  it('builds the locked AAD strings as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(voiceDekAad(ACCOUNT_ID))).toBe(`limmiar/voice-dek/titanet-large/v1|${MODELO_VOZ}|${ACCOUNT_ID}`)
    expect(new TextDecoder().decode(voiceEmbeddingAad(ACCOUNT_ID))).toBe(`limmiar/voice-embedding/titanet-large/v1|${MODELO_VOZ}|${ACCOUNT_ID}`)
  })

  it('the two AADs differ from each other for the same account', () => {
    expect(new TextDecoder().decode(voiceDekAad(ACCOUNT_ID))).not.toBe(
      new TextDecoder().decode(voiceEmbeddingAad(ACCOUNT_ID)),
    )
  })
})

describe('selarEmbedding', () => {
  async function makeKek(): Promise<CryptoKey> {
    return limmiarWebcrypto.importKek(new Uint8Array(32).fill(0x07))
  }

  it('wraps a fresh DEK and seals the embedding as little/native-endian float32 bytes, decryptable back to the same values', async () => {
    const kek = await makeKek()
    const embedding = Array.from({ length: 192 }, (_, i) => [0.5, -0.25, 1.25][i % 3]!)

    const { wrappedDek, sealedEmbedding } = await selarEmbedding(kek, ACCOUNT_ID, embedding)

    const dek = await limmiarWebcrypto.unwrapDek(kek, wrappedDek, voiceDekAad(ACCOUNT_ID))
    const plaintext = await limmiarWebcrypto.decrypt(dek, sealedEmbedding, voiceEmbeddingAad(ACCOUNT_ID))
    expect(Array.from(new Float32Array(plaintext.buffer, plaintext.byteOffset, embedding.length))).toEqual(
      Array.from(Float32Array.from(embedding)),
    )
    expect(await abrirEmbedding(kek, ACCOUNT_ID, wrappedDek, sealedEmbedding)).toEqual(embedding)
    expect(sealedEmbedding.length).toBe(796)
    await expect(abrirEmbedding(kek, 'outra-conta', wrappedDek, sealedEmbedding)).rejects.toThrow()
    await expect(abrirEmbedding(await limmiarWebcrypto.importKek(new Uint8Array(32).fill(8)), ACCOUNT_ID, wrappedDek, sealedEmbedding)).rejects.toThrow()
    sealedEmbedding[20] ^= 1
    await expect(abrirEmbedding(kek, ACCOUNT_ID, wrappedDek, sealedEmbedding)).rejects.toThrow()
  })

  it.each([null, 'x', [], [1], new Array(192).fill(0), new Array(192).fill(NaN), new Array(192).fill(Infinity), new Array(192).fill(1e100), new Array(192).fill('x')].map((valor) => ({ valor })))('recusa perfil inválido $valor', async ({ valor }) => {
    expect(embeddingValido(valor)).toBe(false)
    await expect(selarEmbedding(await makeKek(), ACCOUNT_ID, valor as number[])).rejects.toThrow('inválido')
  })

  it.each([new Uint8Array(4), new Uint8Array(192 * 4), new Uint8Array(Float32Array.from(new Array(192).fill(NaN)).buffer)].map((bytes) => ({ bytes })))('recusa conteúdo aberto incompatível, apagando o buffer', async ({ bytes }) => {
    const kek = await makeKek()
    const { dek, wrapped } = await limmiarWebcrypto.generateWrappedDek(kek, voiceDekAad(ACCOUNT_ID))
    const sealed = await limmiarWebcrypto.encrypt(dek, bytes, voiceEmbeddingAad(ACCOUNT_ID))
    await expect(abrirEmbedding(kek, ACCOUNT_ID, wrapped, sealed)).rejects.toThrow('inválido')
  })
})
