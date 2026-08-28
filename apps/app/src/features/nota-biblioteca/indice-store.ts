import type { CryptoKey } from '@limmiar/crypto'
import type MiniSearch from 'minisearch'
import { carregarIndice, serializarIndice, type DocNota } from './indice'
import { abrirIndice, selarIndice } from './indice-crypto'

export type LerSelado = () => Promise<Uint8Array<ArrayBuffer> | null>
export type GravarSelado = (selado: Uint8Array<ArrayBuffer>) => Promise<void>

// Um único ficheiro por diretório (o índice de busca é um blob por conta, não um chunk por
// seq como live-session/chunk-store.ts) -- o chamador escolhe o `dir` já escopado à conta.
const ARQUIVO_INDICE = 'indice-busca'

/**
 * A única função autorizada a tocar a API OPFS para o índice de busca, tal como
 * `opfsWriter` em `features/live-session/chunk-store.ts` -- `ler`/`gravar` nunca lidam com
 * plaintext, só com o blob já selado (`selarIndice`/`abrirIndice` ficam em `persistirIndice`/
 * `restaurarIndice`, abaixo).
 */
export function opfsIndice(dir: FileSystemDirectoryHandle): { ler: LerSelado; gravar: GravarSelado } {
  return {
    async ler() {
      let handle: FileSystemFileHandle
      try {
        handle = await dir.getFileHandle(ARQUIVO_INDICE)
      } catch (erro) {
        // Só `NotFoundError` (ficheiro ausente) vira `null` -- qualquer outro erro
        // (permissão, quota, disco corrompido) propaga, não é silenciado.
        if (erro instanceof DOMException && erro.name === 'NotFoundError') {
          return null
        }
        throw erro
      }
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>
    },
    async gravar(selado) {
      const handle = await dir.getFileHandle(ARQUIVO_INDICE, { create: true })
      const writable = await handle.createWritable()
      await writable.write(selado)
      await writable.close()
    },
  }
}

/** Serializa + sela + grava -- `gravar` só recebe ciphertext, nunca o JSON do índice. */
export async function persistirIndice(
  gravar: GravarSelado,
  dek: CryptoKey,
  accountId: string,
  indice: MiniSearch<DocNota>,
): Promise<void> {
  const json = serializarIndice(indice)
  const selado = await selarIndice(dek, accountId, json)
  await gravar(selado)
}

/** Inverso de `persistirIndice` -- `null` quando ainda não há índice persistido (primeira
 *  vez, ou OPFS limpa); `accountId` diferente do usado para persistir rejeita (AAD errada
 *  em `abrirIndice`), não abre por bom. */
export async function restaurarIndice(
  ler: LerSelado,
  dek: CryptoKey,
  accountId: string,
): Promise<MiniSearch<DocNota> | null> {
  const selado = await ler()
  if (selado === null) {
    return null
  }
  const json = await abrirIndice(dek, accountId, selado)
  return carregarIndice(json)
}
