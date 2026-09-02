import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { abrirIndice, chaveIndiceDaConta, indiceBuscaAad, indiceBuscaDekAad, selarIndice } from './indice-crypto'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

async function makeChave() {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  return chaveIndiceDaConta(kek)
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

describe('indiceBuscaDekAad', () => {
  it('builds the versioned DEK-wrap AAD string as UTF-8 bytes, distinct do conteúdo', () => {
    expect(new TextDecoder().decode(indiceBuscaDekAad(ACCOUNT_ID))).toBe(`limmiar/note-index-dek/v1|${ACCOUNT_ID}`)
  })
})

describe('chaveIndiceDaConta', () => {
  it('aceita a chave de importKek (usages wrapKey/unwrapKey) e a devolve', async () => {
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))

    expect(chaveIndiceDaConta(kek)).toBe(kek)
  })

  it('lança para uma DEK de generateWrappedDek (usages sem unwrapKey)', async () => {
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    const { dek } = await limmiarWebcrypto.generateWrappedDek(kek, new Uint8Array())

    expect(() => chaveIndiceDaConta(dek)).toThrow()
  })
})

describe('selarIndice / abrirIndice', () => {
  it('round-trips: abrirIndice(selarIndice(json)) devolve o mesmo json', async () => {
    const chave = await makeChave()
    const json = new TextEncoder().encode(JSON.stringify({ a: 1 })) as Uint8Array<ArrayBuffer>

    const selado = await selarIndice(chave, ACCOUNT_ID, json)
    const aberto = await abrirIndice(chave, ACCOUNT_ID, selado)

    expect(toHex(aberto)).toBe(toHex(json))
  })

  it('dois selados da mesma chave diferem nos bytes e ambos abrem (DEK e IV frescos por gravação)', async () => {
    const chave = await makeChave()
    const json = new TextEncoder().encode(JSON.stringify({ a: 1 })) as Uint8Array<ArrayBuffer>

    const seladoUm = await selarIndice(chave, ACCOUNT_ID, json)
    const seladoDois = await selarIndice(chave, ACCOUNT_ID, json)

    expect(toHex(seladoUm)).not.toBe(toHex(seladoDois))
    expect(toHex(await abrirIndice(chave, ACCOUNT_ID, seladoUm))).toBe(toHex(json))
    expect(toHex(await abrirIndice(chave, ACCOUNT_ID, seladoDois))).toBe(toHex(json))
  })

  it('produz um selado que não contém os bytes em claro', async () => {
    const chave = await makeChave()
    const json = new TextEncoder().encode(JSON.stringify({ termo: 'febre alta' })) as Uint8Array<ArrayBuffer>

    const selado = await selarIndice(chave, ACCOUNT_ID, json)

    expect(toHex(selado)).not.toContain(toHex(json))
  })

  it('rejeita abrir sob outra chave (embrulho da DEK falha)', async () => {
    const chave = await makeChave()
    const outraChave = await makeChave()
    const json = new TextEncoder().encode(JSON.stringify({ a: 1 })) as Uint8Array<ArrayBuffer>

    const selado = await selarIndice(chave, ACCOUNT_ID, json)

    await expect(abrirIndice(outraChave, ACCOUNT_ID, selado)).rejects.toThrow()
  })

  // Prova que a AAD liga o índice selado à conta certa -- um accountId diferente do usado
  // para selar tem de rejeitar, não abrir por bom (evita que o índice de busca de uma conta
  // seja lido como se fosse de outra).
  it('rejeita abrir sob um accountId diferente do usado para selar', async () => {
    const chave = await makeChave()
    const json = new TextEncoder().encode(JSON.stringify({ a: 1 })) as Uint8Array<ArrayBuffer>
    const OUTRA_CONTA = '22222222-2222-2222-2222-222222222222'

    const selado = await selarIndice(chave, ACCOUNT_ID, json)

    await expect(abrirIndice(chave, OUTRA_CONTA, selado)).rejects.toThrow()
  })
})
