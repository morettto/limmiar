import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeDirectoryHandle, stubOpfsRoot } from '../../test-support/fake-opfs'
import { chaveIndiceDaConta, type ChaveIndiceBusca } from './indice-crypto'
import { construirIndice } from './indice'
import { opfsIndice, persistirIndice, purgarIndiceBusca, restaurarIndice } from './indice-store'

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

describe('purgarIndiceBusca', () => {
  let restoreOpfsRoot: (() => void) | null = null

  afterEach(() => {
    vi.restoreAllMocks()
    restoreOpfsRoot?.()
    restoreOpfsRoot = null
  })

  it('apaga o blob do indice da conta', async () => {
    const chave = await makeChave()
    const raiz = new FakeDirectoryHandle()
    const dirConta = await raiz.getDirectoryHandle(ACCOUNT_ID, { create: true })
    const { gravar, ler } = opfsIndice(dirConta as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])
    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, IMPRESSAO)
    restoreOpfsRoot = stubOpfsRoot(raiz)

    await purgarIndiceBusca(ACCOUNT_ID)

    expect(await ler()).toBeNull()
  })

  it('conta sem diretorio OPFS e no-op', async () => {
    const raiz = new FakeDirectoryHandle()
    restoreOpfsRoot = stubOpfsRoot(raiz)

    await expect(purgarIndiceBusca(ACCOUNT_ID)).resolves.toBeUndefined()
  })

  it('propaga um Error simples em vez de o engolir', async () => {
    const raizComErro = {
      getDirectoryHandle: async () => {
        throw new Error('disco corrompido')
      },
    } as unknown as FakeDirectoryHandle
    restoreOpfsRoot = stubOpfsRoot(raizComErro)

    await expect(purgarIndiceBusca(ACCOUNT_ID)).rejects.toThrow('disco corrompido')
  })

  it('propaga uma DOMException que nao seja NotFoundError', async () => {
    const raizComErro = {
      getDirectoryHandle: async () => {
        throw new DOMException('sem permissao', 'NotAllowedError')
      },
    } as unknown as FakeDirectoryHandle
    restoreOpfsRoot = stubOpfsRoot(raizComErro)

    await expect(purgarIndiceBusca(ACCOUNT_ID)).rejects.toThrow('sem permissao')
  })

  // Critério de aceite 4: depois da purga, restaurar devolve null por ausência de blob, não
  // por impressão que não bate -- só o `not.toHaveBeenCalled()` distingue os dois casos, já
  // que ambos devolvem null (ver o teste "devolve null e apaga o blob..." em restaurarIndice).
  it('depois de purgar, restaurarIndice devolve null sem chamar apagar de novo', async () => {
    const chave = await makeChave()
    const raiz = new FakeDirectoryHandle()
    const dirConta = await raiz.getDirectoryHandle(ACCOUNT_ID, { create: true })
    const { gravar, ler, apagar } = opfsIndice(dirConta as unknown as FileSystemDirectoryHandle)
    const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])
    await persistirIndice(gravar, chave, ACCOUNT_ID, indice, IMPRESSAO)
    restoreOpfsRoot = stubOpfsRoot(raiz)

    await purgarIndiceBusca(ACCOUNT_ID)
    const apagarEspiado = vi.fn(apagar)
    const restaurado = await restaurarIndice({ ler, apagar: apagarEspiado }, chave, ACCOUNT_ID, IMPRESSAO)

    expect(restaurado).toBeNull()
    expect(apagarEspiado).not.toHaveBeenCalled()
  })
})

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
