import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { audioChunkAad, sealChunk } from './audio-crypto'

const SESSION_ID = '11111111-1111-1111-1111-111111111111'

async function makeDek(): Promise<CryptoKey> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  const { dek } = await limmiarWebcrypto.generateWrappedDek(kek, new Uint8Array())
  return dek
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('audioChunkAad', () => {
  it('builds the versioned AAD string as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(audioChunkAad(SESSION_ID, 3))).toBe(`limmiar/audio-chunk/v1|${SESSION_ID}|3`)
  })
})

describe('sealChunk', () => {
  it('produces ciphertext that does not contain the plaintext bytes', async () => {
    const dek = await makeDek()
    const chunk = crypto.getRandomValues(new Uint8Array(64))

    const sealed = await sealChunk(dek, SESSION_ID, 1, chunk)

    expect(toHex(sealed)).not.toContain(toHex(chunk))
  })

  it('round-trips through decrypt under the matching AAD', async () => {
    const dek = await makeDek()
    const chunk = crypto.getRandomValues(new Uint8Array(64))

    const sealed = await sealChunk(dek, SESSION_ID, 5, chunk)
    const opened = await limmiarWebcrypto.decrypt(dek, sealed, audioChunkAad(SESSION_ID, 5))

    expect(toHex(opened)).toBe(toHex(chunk))
  })

  // Proves the AAD actually binds ciphertext to (sessionId, seq), not just that
  // encrypt/decrypt round-trips -- a regression that swapped audioChunkAad for a
  // constant would still pass the test above and only fail here.
  it('throws when opened under a different seq', async () => {
    const dek = await makeDek()
    const chunk = crypto.getRandomValues(new Uint8Array(64))

    const sealed = await sealChunk(dek, SESSION_ID, 5, chunk)

    await expect(limmiarWebcrypto.decrypt(dek, sealed, audioChunkAad(SESSION_ID, 6))).rejects.toThrow()
  })
})
