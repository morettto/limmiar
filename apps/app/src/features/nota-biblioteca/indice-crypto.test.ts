import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { abrirIndice, indiceBuscaAad, selarIndice } from './indice-crypto'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

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

describe('indiceBuscaAad', () => {
  it('builds the versioned AAD string as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(indiceBuscaAad(ACCOUNT_ID))).toBe(`limmiar/note-index/v1|${ACCOUNT_ID}`)
  })
})

describe('selarIndice / abrirIndice', () => {
  it('round-trips: abrirIndice(selarIndice(json)) devolve o mesmo json', async () => {
    const dek = await makeDek()
    const json = new TextEncoder().encode(JSON.stringify({ a: 1 })) as Uint8Array<ArrayBuffer>

    const selado = await selarIndice(dek, ACCOUNT_ID, json)
    const aberto = await abrirIndice(dek, ACCOUNT_ID, selado)

    expect(toHex(aberto)).toBe(toHex(json))
  })

  it('produz um selado que não contém os bytes em claro', async () => {
    const dek = await makeDek()
    const json = new TextEncoder().encode(JSON.stringify({ termo: 'febre alta' })) as Uint8Array<ArrayBuffer>

    const selado = await selarIndice(dek, ACCOUNT_ID, json)

    expect(toHex(selado)).not.toContain(toHex(json))
  })

  // Prova que a AAD liga o índice selado à conta certa -- um accountId diferente do usado
  // para selar tem de rejeitar, não abrir por bom (evita que o índice de busca de uma conta
  // seja lido como se fosse de outra).
  it('rejeita abrir sob um accountId diferente do usado para selar', async () => {
    const dek = await makeDek()
    const json = new TextEncoder().encode(JSON.stringify({ a: 1 })) as Uint8Array<ArrayBuffer>
    const OUTRA_CONTA = '22222222-2222-2222-2222-222222222222'

    const selado = await selarIndice(dek, ACCOUNT_ID, json)

    await expect(abrirIndice(dek, OUTRA_CONTA, selado)).rejects.toThrow()
  })
})
