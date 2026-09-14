/** Apaga `<raiz OPFS>/<accountId>` inteira. Diretório ausente: no-op, outro erro propaga.
 *  `getDirectory()` fica dentro do `try`: a spec de OPFS não dá `NotFoundError` aí (rejeita com
 *  `SecurityError`/`UnknownError`) -- separar os dois `await` duplicaria a guarda por um caso que não existe. */
export async function purgarOpfsDaConta(accountId: string): Promise<void> {
  try {
    const raiz = await navigator.storage.getDirectory()
    await raiz.removeEntry(accountId, { recursive: true })
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'NotFoundError') {
      return
    }
    throw erro
  }
}
