import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { describe, expect, it, vi } from 'vitest'
import { sealChunk } from '../live-session/audio-crypto'
import { abrirSessaoComoBlob, criarReprodutor } from './reprodutor'

const SESSION_ID = '11111111-1111-1111-1111-111111111111'

// jsdom não implementa HTMLMediaElement.play()/pause() -- este duplo tem só as duas
// propriedades e os dois métodos que criarReprodutor de facto usa.
function audioDuplo(): HTMLAudioElement {
  return {
    currentTime: 0,
    play: vi.fn(),
    pause: vi.fn(),
  } as unknown as HTMLAudioElement
}

async function makeDek(): Promise<CryptoKey> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  const { dek } = await limmiarWebcrypto.generateWrappedDek(kek, new Uint8Array())
  return dek
}

// Mesma disciplina do mock local de chunk-store.test.ts: sem OPFS em Node/Vitest e sem
// precedente de mock de repositório para a File System Access API -- só os métodos que
// abrirSessaoComoBlob de facto usa (getFileHandle -> getFile, keys).
class FakeFile {
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.buffer as ArrayBuffer
  }
}

class FakeFileHandle {
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  async getFile(): Promise<FakeFile> {
    return new FakeFile(this.bytes)
  }
}

class FakeDirectoryHandle {
  files = new Map<string, Uint8Array>()
  async getFileHandle(name: string): Promise<FakeFileHandle> {
    const bytes = this.files.get(name)
    if (!bytes) throw new Error(`no such file: ${name}`)
    return new FakeFileHandle(bytes)
  }
  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.files.keys()) yield name
  }
}

function fakeDir(): FakeDirectoryHandle {
  return new FakeDirectoryHandle()
}

describe('criarReprodutor', () => {
  it('tocar(inicioMs) posiciona currentTime em segundos e chama play()', () => {
    const audio = audioDuplo()
    const reprodutor = criarReprodutor(audio)

    reprodutor.tocar(2500)

    expect(audio.currentTime).toBe(2.5)
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it('parar() chama pause()', () => {
    const audio = audioDuplo()
    const reprodutor = criarReprodutor(audio)

    reprodutor.parar()

    expect(audio.pause).toHaveBeenCalledTimes(1)
  })
})

describe('abrirSessaoComoBlob', () => {
  it('lê os chunks por ordem de seq e concatena o plaintext original', async () => {
    const dek = await makeDek()
    const dir = fakeDir()
    const partes = [
      crypto.getRandomValues(new Uint8Array(8)),
      crypto.getRandomValues(new Uint8Array(8)),
      crypto.getRandomValues(new Uint8Array(8)),
    ]
    // Inserção fora de ordem (2, 0, 1) -- prova que a leitura ordena por seq, não por
    // ordem de inserção/iteração do diretório.
    dir.files.set('2', await sealChunk(dek, SESSION_ID, 2, partes[2] as Uint8Array<ArrayBuffer>))
    dir.files.set('0', await sealChunk(dek, SESSION_ID, 0, partes[0] as Uint8Array<ArrayBuffer>))
    dir.files.set('1', await sealChunk(dek, SESSION_ID, 1, partes[1] as Uint8Array<ArrayBuffer>))

    const blob = await abrirSessaoComoBlob(dir as unknown as FileSystemDirectoryHandle, dek, SESSION_ID)
    const bytes = new Uint8Array(await blob.arrayBuffer())

    const esperado = new Uint8Array(partes.flatMap((parte) => Array.from(parte)))
    expect(Array.from(bytes)).toEqual(Array.from(esperado))
  })

  it('rejeita uma sessão sem chunks em vez de devolver um Blob vazio silenciosamente', async () => {
    const dek = await makeDek()

    await expect(abrirSessaoComoBlob(fakeDir() as unknown as FileSystemDirectoryHandle, dek, SESSION_ID)).rejects.toThrow()
  })

  // Um chunk que falha a abrir (aqui: selado sob outro sessionId, chegou ao dir errado)
  // não pode ser saltado em silêncio -- a leitura inteira tem de rejeitar.
  it('rejeita a sessão inteira se um chunk falhar a abrir, em vez de saltá-lo em silêncio', async () => {
    const dek = await makeDek()
    const dir = fakeDir()
    dir.files.set('0', await sealChunk(dek, SESSION_ID, 0, new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>))
    dir.files.set('1', await sealChunk(dek, 'outra-sessao', 1, new Uint8Array([4, 5, 6]) as Uint8Array<ArrayBuffer>))

    await expect(abrirSessaoComoBlob(dir as unknown as FileSystemDirectoryHandle, dek, SESSION_ID)).rejects.toThrow()
  })
})
