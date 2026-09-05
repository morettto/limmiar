// Duplo mínimo da File System Access API (OPFS), partilhado pelos testes de chunk-store,
// reprodutor e indice-store: só a superfície que os três usam. Nasceu na terceira duplicação
// do duplo local (S08-02).

// Bytes só ficam visíveis em `handle.bytes` depois de `close()`, como na API real, e
// `getFileHandle`/`removeEntry` sobre um nome ausente lançam `NotFoundError` -- é disso que
// `opfsIndice()` depende para distinguir "ficheiro ausente" de qualquer outro erro.

export class FakeWritable {
  private readonly handle: FakeFileHandle
  private partes: Uint8Array[] = []

  constructor(handle: FakeFileHandle) {
    this.handle = handle
  }

  async write(dados: Uint8Array): Promise<void> {
    this.partes.push(dados)
  }

  async close(): Promise<void> {
    const total = this.partes.reduce((soma, parte) => soma + parte.length, 0)
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const parte of this.partes) {
      bytes.set(parte, offset)
      offset += parte.length
    }
    this.handle.bytes = bytes
  }
}

export class FakeFileHandle {
  bytes: Uint8Array

  constructor(bytes: Uint8Array = new Uint8Array()) {
    this.bytes = bytes
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this)
  }

  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const bytes = this.bytes
    return { arrayBuffer: async () => bytes.buffer as ArrayBuffer }
  }
}

export class FakeDirectoryHandle {
  files = new Map<string, FakeFileHandle>()
  dirs = new Map<string, FakeDirectoryHandle>()

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existente = this.files.get(name)
    if (existente) return existente
    if (!options?.create) {
      throw new DOMException(`ficheiro inexistente: ${name}`, 'NotFoundError')
    }
    const handle = new FakeFileHandle()
    this.files.set(name, handle)
    return handle
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    const existente = this.dirs.get(name)
    if (existente) return existente
    if (!options?.create) {
      throw new DOMException(`diretorio inexistente: ${name}`, 'NotFoundError')
    }
    const handle = new FakeDirectoryHandle()
    this.dirs.set(name, handle)
    return handle
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.files.keys()) yield name
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) {
      throw new DOMException(`ficheiro inexistente: ${name}`, 'NotFoundError')
    }
  }
}

/** Atalho para quem só precisa do tipo (não vai inspecionar `.files` depois). */
export function fakeDir(): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle() as unknown as FileSystemDirectoryHandle
}

/** jsdom não implementa `navigator.storage` -- semeia `getDirectory()` com uma raiz fake para o
 *  teste, e devolve o restore que o `afterEach` chama para não vazar entre testes. */
export function stubOpfsRoot(raiz: FakeDirectoryHandle): () => void {
  Object.defineProperty(navigator, 'storage', {
    value: { getDirectory: async () => raiz },
    configurable: true,
  })
  // ponytail: assume jsdom sem `navigator.storage` prévio, por isso o restore é sempre
  // `delete`; se algum dia houver polyfill global, repor o descritor anterior aqui.
  return () => {
    delete (navigator as { storage?: unknown }).storage
  }
}
