import { afterEach, describe, expect, it } from 'vitest'
import { FakeDirectoryHandle, stubOpfsRoot } from '../../test-support/fake-opfs'
import { purgarOpfsDaConta } from './opfs-conta'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

describe('purgarOpfsDaConta', () => {
  let restoreOpfsRoot: (() => void) | null = null

  afterEach(() => {
    restoreOpfsRoot?.()
    restoreOpfsRoot = null
  })

  it('apaga a arvore inteira da conta', async () => {
    const raiz = new FakeDirectoryHandle()
    const dirConta = await raiz.getDirectoryHandle(ACCOUNT_ID, { create: true })
    await dirConta.getFileHandle('indice-busca', { create: true })
    await dirConta.getFileHandle('0', { create: true })
    restoreOpfsRoot = stubOpfsRoot(raiz)

    await purgarOpfsDaConta(ACCOUNT_ID)

    expect(raiz.dirs.has(ACCOUNT_ID)).toBe(false)
  })

  it('conta sem diretorio OPFS e no-op', async () => {
    const raiz = new FakeDirectoryHandle()
    restoreOpfsRoot = stubOpfsRoot(raiz)

    await expect(purgarOpfsDaConta(ACCOUNT_ID)).resolves.toBeUndefined()
  })

  it('propaga uma DOMException que nao seja NotFoundError', async () => {
    const raizComErro = {
      removeEntry: async () => {
        throw new DOMException('sem permissao', 'NotAllowedError')
      },
    } as unknown as FakeDirectoryHandle
    restoreOpfsRoot = stubOpfsRoot(raizComErro)

    await expect(purgarOpfsDaConta(ACCOUNT_ID)).rejects.toThrow('sem permissao')
  })

  it('propaga um Error simples em vez de o engolir', async () => {
    const raizComErro = {
      removeEntry: async () => {
        throw new Error('disco corrompido')
      },
    } as unknown as FakeDirectoryHandle
    restoreOpfsRoot = stubOpfsRoot(raizComErro)

    await expect(purgarOpfsDaConta(ACCOUNT_ID)).rejects.toThrow('disco corrompido')
  })
})
