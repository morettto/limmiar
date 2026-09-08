import type MiniSearch from 'minisearch'
import { carregarIndice, serializarIndice, type DocNota } from './indice'
import { abrirIndice, selarIndice, type ChaveIndiceBusca } from './indice-crypto'

export type LerSelado = () => Promise<Uint8Array<ArrayBuffer> | null>
export type GravarSelado = (selado: Uint8Array<ArrayBuffer>) => Promise<void>
export type ApagarSelado = () => Promise<void>

// Um único ficheiro por diretório (o índice de busca é um blob por conta, não um chunk por
// seq como live-session/chunk-store.ts) -- o chamador escolhe o `dir` já escopado à conta.
const ARQUIVO_INDICE = 'indice-busca'

/**
 * A única função autorizada a tocar a API OPFS para o índice de busca, tal como `opfsWriter` em
 * `chunk-store.ts`: `ler`/`gravar` nunca lidam com plaintext, só com o blob já selado.
 */
export function opfsIndice(
  dir: FileSystemDirectoryHandle,
): { ler: LerSelado; gravar: GravarSelado; apagar: ApagarSelado } {
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
    async apagar() {
      await dir.removeEntry(ARQUIVO_INDICE)
    },
  }
}

/** Serializa + sela + grava -- `gravar` só recebe ciphertext, nunca o JSON do índice. */
export async function persistirIndice(
  gravar: GravarSelado,
  chave: ChaveIndiceBusca,
  accountId: string,
  indice: MiniSearch<DocNota>,
  impressao: string,
): Promise<void> {
  const json = serializarIndice(indice, impressao)
  const selado = await selarIndice(chave, accountId, json)
  await gravar(selado)
}

/** Inverso de `persistirIndice`: `null` quando não há índice persistido, rejeita quando o
 *  `accountId` não bate (AAD errada), e apaga o blob obsoleto quando a impressão não bate --
 *  texto em claro de uma nota corrigida não sobrevive no disco. */
export async function restaurarIndice(
  store: { ler: LerSelado; apagar: ApagarSelado },
  chave: ChaveIndiceBusca,
  accountId: string,
  impressao: string,
): Promise<MiniSearch<DocNota> | null> {
  const selado = await store.ler()
  if (selado === null) {
    return null
  }
  const json = await abrirIndice(chave, accountId, selado)
  const indice = carregarIndice(json, impressao)
  if (indice === null) {
    // Rejeição de `apagar` ignorada de propósito: o `gravar` seguinte usa `createWritable()`,
    // que trunca o ficheiro, então o blob obsoleto é sobrescrito de qualquer forma. Propagar
    // deixaria o blob em claro no disco E a página presa no erro.
    await store.apagar().catch(() => {})
    return null
  }
  return indice
}
