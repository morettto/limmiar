import { describe, expect, it } from 'vitest'
import { FakeDirectoryHandle, fakeDir } from '../../test-support/fake-opfs'
import { listarOrfaos } from './opfs'

describe('listarOrfaos', () => {
  it('lists file names present in the directory', async () => {
    const dir = new FakeDirectoryHandle()
    await dir.getFileHandle('1', { create: true })
    await dir.getFileHandle('2', { create: true })

    const names = await listarOrfaos(dir as unknown as FileSystemDirectoryHandle)

    expect(names.sort()).toEqual(['1', '2'])
  })

  it('returns an empty list for an empty directory', async () => {
    const names = await listarOrfaos(fakeDir())

    expect(names).toEqual([])
  })
})
