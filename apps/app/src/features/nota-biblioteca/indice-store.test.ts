import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { FakeDirectoryHandle } from '../../test-support/fake-opfs'
import { construirIndice } from './indice'
import { opfsIndice, persistirIndice, restaurarIndice } from './indice-store'

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

describe('restaurarIndice', () => {
  it('devolve null quando o ficheiro ainda não existe', async () => {
    const dek = await makeDek()
    const dir = new FakeDirectoryHandle()
    const { ler } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)

    const indice = await restaurarIndice(ler, dek, ACCOUNT_ID)

    expect(indice).toBeNull()
  })

  // Só NotFoundError vira null (ficheiro ausente é o único caso "normal"); qualquer outro
  // erro do OPFS (permissão, quota, disco corrompido) tem de propagar, não ser silenciado.
  it('propaga um erro que não seja NotFoundError, em vez de o tratar como ausente', async () => {
    const dek = await makeDek()
    const dirComErro = {
      getFileHandle: async () => {
        throw new DOMException('sem permissão', 'NotAllowedError')
      },
    } as unknown as FileSystemDirectoryHandle
    const { ler } = opfsIndice(dirComErro)

    await expect(restaurarIndice(ler, dek, ACCOUNT_ID)).rejects.toThrow('sem permissão')
  })
})

describe('persistirIndice / restaurarIndice', () => {
  it('restaura um índice que acha o mesmo que o original', async () => {
    const dek = await makeDek()
    const dir = new FakeDirectoryHandle()
    const { ler, gravar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indiceOriginal = construirIndice([
      { id: '1', patientId: 'p1', texto: 'febre alta e tosse' },
      { id: '2', patientId: 'p2', texto: 'dor de cabeça' },
    ])

    await persistirIndice(gravar, dek, ACCOUNT_ID, indiceOriginal)
    const indiceRestaurado = await restaurarIndice(ler, dek, ACCOUNT_ID)

    expect(indiceRestaurado).not.toBeNull()
    expect(indiceRestaurado!.search('febre').map((r) => r.id)).toEqual(['1'])
  })

  // Coração do critério de aceite 1: os bytes que chegam a `gravar` são o índice cifrado,
  // nunca o JSON em claro -- um termo pesquisável tem de ficar ausente do que é persistido.
  it('os bytes gravados não contêm o termo em claro', async () => {
    const dek = await makeDek()
    let capturado: Uint8Array<ArrayBuffer> | undefined
    const gravar = async (selado: Uint8Array<ArrayBuffer>) => {
      capturado = selado
    }
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'diagnostico-super-especifico' }])

    await persistirIndice(gravar, dek, ACCOUNT_ID, indice)

    expect(capturado).toBeDefined()
    const termoEmBytes = new TextEncoder().encode('diagnostico-super-especifico')
    expect(toHex(capturado!)).not.toContain(toHex(termoEmBytes))
  })

  it('rejeita restaurar sob um accountId diferente do usado para persistir', async () => {
    const dek = await makeDek()
    const dir = new FakeDirectoryHandle()
    const { ler, gravar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])

    await persistirIndice(gravar, dek, ACCOUNT_ID, indice)

    await expect(restaurarIndice(ler, dek, 'outra-conta')).rejects.toThrow()
  })
})
