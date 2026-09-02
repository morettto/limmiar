import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it, vi } from 'vitest'
import { FakeDirectoryHandle } from '../../test-support/fake-opfs'
import { chaveIndiceDaConta, type ChaveIndiceBusca } from './indice-crypto'
import { construirIndice } from './indice'
import { opfsIndice, persistirIndice, restaurarIndice } from './indice-store'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const IMPRESSAO = '1:0|2:0'

async function makeChave(): Promise<ChaveIndiceBusca> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  return chaveIndiceDaConta(kek)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('opfsIndice', () => {
  it('apagar remove o ficheiro selado do diretório', async () => {
    const chave = await makeChave()
    const dir = new FakeDirectoryHandle()
    const { gravar, apagar, ler } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])
    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, IMPRESSAO)

    await apagar()

    expect(await ler()).toBeNull()
  })
})

describe('restaurarIndice', () => {
  it('devolve null quando o ficheiro ainda não existe, sem chamar apagar', async () => {
    const chave = await makeChave()
    const dir = new FakeDirectoryHandle()
    const { ler, apagar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const apagarEspiado = vi.fn(apagar)

    const indice = await restaurarIndice({ ler, apagar: apagarEspiado }, chave, ACCOUNT_ID, IMPRESSAO)

    expect(indice).toBeNull()
    expect(apagarEspiado).not.toHaveBeenCalled()
  })

  // Só NotFoundError vira null (ficheiro ausente é o único caso "normal"); qualquer outro
  // erro do OPFS (permissão, quota, disco corrompido) tem de propagar, não ser silenciado.
  it('propaga um erro que não seja NotFoundError, em vez de o tratar como ausente', async () => {
    const chave = await makeChave()
    const dirComErro = {
      getFileHandle: async () => {
        throw new DOMException('sem permissão', 'NotAllowedError')
      },
    } as unknown as FileSystemDirectoryHandle
    const { ler, apagar } = opfsIndice(dirComErro)

    await expect(restaurarIndice({ ler, apagar }, chave, ACCOUNT_ID, IMPRESSAO)).rejects.toThrow('sem permissão')
  })

  // O vermelho do ticket: persistir com duas notas, mudar a revisão de uma, restaurar tem
  // de devolver null -- e o blob obsoleto é apagado, não só ignorado (critério de aceite 3).
  it('devolve null e apaga o blob quando a impressão não bate (revisão de uma nota mudou)', async () => {
    const chave = await makeChave()
    const dir = new FakeDirectoryHandle()
    const { ler, gravar, apagar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([
      { id: '1', patientId: 'p1', texto: 'febre alta' },
      { id: '2', patientId: 'p2', texto: 'dor de cabeça' },
    ])
    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, '1:0|2:0')
    const apagarEspiado = vi.fn(apagar)

    const restaurado = await restaurarIndice({ ler, apagar: apagarEspiado }, chave, ACCOUNT_ID, '1:1|2:0')

    expect(restaurado).toBeNull()
    expect(apagarEspiado).toHaveBeenCalledTimes(1)
    expect(await ler()).toBeNull()
  })

  // Achado da review, ronda 2: uma rejeição de `apagar` (OPFS negada/cheia/corrompida) não
  // pode propagar -- `restaurarIndice` já está no caminho de recuperação do índice obsoleto,
  // e o `gravar` seguinte de `persistirIndice` sobrescreve o blob de qualquer forma.
  it('devolve null mesmo quando apagar rejeita (índice obsoleto, OPFS falha ao remover)', async () => {
    const chave = await makeChave()
    const dir = new FakeDirectoryHandle()
    const { ler, gravar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])
    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, '1:0')
    const apagarQueRejeita = vi.fn(async () => {
      throw new Error('sem permissão para remover')
    })

    const restaurado = await restaurarIndice({ ler, apagar: apagarQueRejeita }, chave, ACCOUNT_ID, '1:1')

    expect(restaurado).toBeNull()
    expect(apagarQueRejeita).toHaveBeenCalledTimes(1)
  })
})

describe('persistirIndice / restaurarIndice', () => {
  it('restaura um índice que acha o mesmo que o original', async () => {
    const chave = await makeChave()
    const dir = new FakeDirectoryHandle()
    const { ler, gravar, apagar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indiceOriginal = construirIndice([
      { id: '1', patientId: 'p1', texto: 'febre alta e tosse' },
      { id: '2', patientId: 'p2', texto: 'dor de cabeça' },
    ])

    await persistirIndice(gravar, chave, ACCOUNT_ID, indiceOriginal, IMPRESSAO)
    const indiceRestaurado = await restaurarIndice({ ler, apagar }, chave, ACCOUNT_ID, IMPRESSAO)

    expect(indiceRestaurado).not.toBeNull()
    expect(indiceRestaurado!.search('febre').map((r) => r.id)).toEqual(['1'])
  })

  // Coração do critério de aceite 1: os bytes que chegam a `gravar` são o índice cifrado,
  // nunca o JSON em claro -- um termo pesquisável tem de ficar ausente do que é persistido.
  it('os bytes gravados não contêm o termo em claro', async () => {
    const chave = await makeChave()
    let capturado: Uint8Array<ArrayBuffer> | undefined
    const gravar = async (selado: Uint8Array<ArrayBuffer>) => {
      capturado = selado
    }
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'diagnostico-super-especifico' }])

    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, IMPRESSAO)

    expect(capturado).toBeDefined()
    const termoEmBytes = new TextEncoder().encode('diagnostico-super-especifico')
    expect(toHex(capturado!)).not.toContain(toHex(termoEmBytes))
  })

  it('rejeita restaurar sob um accountId diferente do usado para persistir', async () => {
    const chave = await makeChave()
    const dir = new FakeDirectoryHandle()
    const { ler, gravar, apagar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])

    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, IMPRESSAO)

    await expect(restaurarIndice({ ler, apagar }, chave, 'outra-conta', IMPRESSAO)).rejects.toThrow()
  })
})
