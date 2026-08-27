import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it } from 'vitest'
import { audioChunkAad } from './audio-crypto'
import { listarOrfaos, opfsWriter, persistChunk, type WriteSealed } from './chunk-store'

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

// No OPFS in Node/Vitest and no repo precedent for a File System Access API mock (grepped
// apps/app/src and beyond) -- minimal local mock, only the surface chunk-store.ts actually uses.
class FakeWritable {
  chunks: Uint8Array[] = []
  closed = false
  async write(data: Uint8Array): Promise<void> {
    this.chunks.push(data)
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

class FakeFileHandle {
  writable?: FakeWritable
  async createWritable(): Promise<FakeWritable> {
    this.writable = new FakeWritable()
    return this.writable
  }
}

class FakeDirectoryHandle {
  files = new Map<string, FakeFileHandle>()
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.files.get(name)
    if (existing) return existing
    if (!options?.create) throw new Error(`no such file: ${name}`)
    const handle = new FakeFileHandle()
    this.files.set(name, handle)
    return handle
  }
  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.files.keys()) yield name
  }
}

function fakeDir(): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle() as unknown as FileSystemDirectoryHandle
}

describe('opfsWriter', () => {
  it('writes the sealed bytes to a file named by seq, then closes the stream', async () => {
    const dir = new FakeDirectoryHandle()
    const write = opfsWriter(dir as unknown as FileSystemDirectoryHandle)
    const sealed = crypto.getRandomValues(new Uint8Array(48)) as Uint8Array<ArrayBuffer>

    await write(SESSION_ID, 3, sealed)

    const handle = dir.files.get('3')
    expect(handle).toBeDefined()
    expect(handle!.writable!.chunks).toEqual([sealed])
    expect(handle!.writable!.closed).toBe(true)
  })

  it('names each chunk by its own seq, not overwriting siblings', async () => {
    const dir = new FakeDirectoryHandle()
    const write = opfsWriter(dir as unknown as FileSystemDirectoryHandle)

    await write(SESSION_ID, 1, new Uint8Array([1]) as Uint8Array<ArrayBuffer>)
    await write(SESSION_ID, 2, new Uint8Array([2]) as Uint8Array<ArrayBuffer>)

    expect([...dir.files.keys()].sort()).toEqual(['1', '2'])
  })
})

describe('persistChunk', () => {
  it('never hands write() plaintext -- only sealChunk output', async () => {
    const dek = await makeDek()
    const blob = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>
    let captured: Uint8Array<ArrayBuffer> | undefined
    const write: WriteSealed = async (_sessionId, _seq, sealed) => {
      captured = sealed
    }

    await persistChunk(write, dek, SESSION_ID, 1, blob)

    expect(captured).toBeDefined()
    expect(toHex(captured!)).not.toBe(toHex(blob))
    // Prove `captured` is real ciphertext of `blob` (sealChunk was actually used, not some
    // other transform) by decrypting it back under the same AAD sealChunk would have used.
    const opened = await limmiarWebcrypto.decrypt(dek, captured!, audioChunkAad(SESSION_ID, 1))
    expect(toHex(opened)).toBe(toHex(blob))
  })

  it('forwards sessionId and seq to write unchanged', async () => {
    const dek = await makeDek()
    const blob = new Uint8Array([9, 9, 9]) as Uint8Array<ArrayBuffer>
    const calls: Array<[string, number]> = []
    const write: WriteSealed = async (sessionId, seq) => {
      calls.push([sessionId, seq])
    }

    await persistChunk(write, dek, SESSION_ID, 7, blob)

    expect(calls).toEqual([[SESSION_ID, 7]])
  })

  it('composed with opfsWriter, only ciphertext ever reaches the OPFS mock', async () => {
    const dek = await makeDek()
    const dir = new FakeDirectoryHandle()
    const write = opfsWriter(dir as unknown as FileSystemDirectoryHandle)
    const blob = crypto.getRandomValues(new Uint8Array(64)) as Uint8Array<ArrayBuffer>

    await persistChunk(write, dek, SESSION_ID, 2, blob)

    const written = dir.files.get('2')!.writable!.chunks[0] as Uint8Array<ArrayBuffer>
    expect(toHex(written)).not.toBe(toHex(blob))
    const opened = await limmiarWebcrypto.decrypt(dek, written, audioChunkAad(SESSION_ID, 2))
    expect(toHex(opened)).toBe(toHex(blob))
  })
})

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
