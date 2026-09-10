import { webcrypto as limmiarWebcrypto, type CryptoKey } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { selarEmbedding, voiceDekAad, voiceEmbeddingAad } from './voice-crypto'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

describe('voiceDekAad / voiceEmbeddingAad', () => {
  it('builds the locked AAD strings as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(voiceDekAad(ACCOUNT_ID))).toBe(`limmiar/voice-dek/v1|${ACCOUNT_ID}`)
    expect(new TextDecoder().decode(voiceEmbeddingAad(ACCOUNT_ID))).toBe(`limmiar/voice-embedding/v1|${ACCOUNT_ID}`)
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
    const embedding = [0.5, -0.25, 1.25]

    const { wrappedDek, sealedEmbedding } = await selarEmbedding(kek, ACCOUNT_ID, embedding)

    const dek = await limmiarWebcrypto.unwrapDek(kek, wrappedDek, voiceDekAad(ACCOUNT_ID))
    const plaintext = await limmiarWebcrypto.decrypt(dek, sealedEmbedding, voiceEmbeddingAad(ACCOUNT_ID))
    expect(Array.from(new Float32Array(plaintext.buffer, plaintext.byteOffset, embedding.length))).toEqual(
      Array.from(Float32Array.from(embedding)),
    )
  })
})
