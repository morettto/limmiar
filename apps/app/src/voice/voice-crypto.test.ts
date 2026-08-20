import { describe, expect, it } from 'vitest'
import { voiceDekAad, voiceEmbeddingAad } from './voice-crypto'

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
