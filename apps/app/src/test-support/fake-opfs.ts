// Duplo mínimo da File System Access API (OPFS), partilhado por quem só grava
// (features/live-session/chunk-store.test.ts), quem só lê (features/nota-audio/
// reprodutor.test.ts) e quem faz as duas coisas (features/nota-biblioteca/
// indice-store.test.ts). Sem OPFS em Node/Vitest e sem precedente de mock de repositório
// para esta API (grepped apps/app/src e beyond) -- só a superfície que os três chamadores
// de facto usam: getFileHandle (com/sem `{ create }`), createWritable/write/close,
// getFile/arrayBuffer, keys(). Nasceu na terceira duplicação deste duplo local (S08-02) --
// ver handoff do S08-01 sobre chunk-store.test.ts/reprodutor.test.ts já terem duplicado uma
// vez.
//
// Bytes só ficam visíveis em `handle.bytes` depois de `close()` -- espelha a API real (a
// escrita não é persistida antes do stream fechar), e poupa um campo `closed` à parte só
// para o mesmo facto: um chamador que esqueça `close()` nunca vê `handle.bytes` mudar.
//
// `getFileHandle` sem `{ create }` sobre um nome ausente lança `DOMException` com
// `name: 'NotFoundError'`, como a API real -- é o que `opfsIndice().ler` (indice-store.ts)
// depende para distinguir "ficheiro ausente" de qualquer outro erro.

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

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.files.keys()) yield name
  }
}

/** Atalho para quem só precisa do tipo (não vai inspecionar `.files` depois). */
export function fakeDir(): FileSystemDirectoryHandle {
  return new FakeDirectoryHandle() as unknown as FileSystemDirectoryHandle
}
