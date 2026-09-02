import { type CryptoKey, webcrypto } from '@limmiar/crypto'

// Mesma disciplina de features/live-session/audio-crypto.ts: prefixo com versão, AAD
// vinculada ao dono do conteúdo (aqui a conta, não a sessão) -- se o formato mudar um dia,
// um novo prefixo evita colidir com índices já selados sob o `v1`.
const NOTE_INDEX_AAD_PREFIX = 'limmiar/note-index/v1|'

export function indiceBuscaAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${NOTE_INDEX_AAD_PREFIX}${accountId}`)
}

/** Sela o índice de busca (JSON serializado, ver indice.ts) sob a DEK da conta. Wire
 *  format: iv(12) || ciphertext || tag(16), igual a `sealChunk`. */
export function selarIndice(
  dek: CryptoKey,
  accountId: string,
  json: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.encrypt(dek, json, indiceBuscaAad(accountId))
}

/** Inverso de `selarIndice` -- rejeita se `accountId` não for o mesmo usado para selar
 *  (AAD errada), o que impede o índice de busca de uma conta de abrir sob outra. */
export function abrirIndice(
  dek: CryptoKey,
  accountId: string,
  selado: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.decrypt(dek, selado, indiceBuscaAad(accountId))
}
