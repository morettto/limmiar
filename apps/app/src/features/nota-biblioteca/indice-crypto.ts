import { type CryptoKey, webcrypto } from '@limmiar/crypto'

// Mesma disciplina de features/live-session/audio-crypto.ts: prefixo com versão, AAD
// vinculada ao dono do conteúdo (aqui a conta, não a sessão) -- se o formato mudar um dia,
// um novo prefixo evita colidir com índices já selados sob o `v1`.
const NOTE_INDEX_AAD_PREFIX = 'limmiar/note-index/v1|'
// AAD do embrulho da DEK (distinta da AAD do conteúdo acima) -- mesmo padrão de
// copilot-crypto.ts/voice-crypto.ts, uma AAD por uso.
const NOTE_INDEX_DEK_AAD_PREFIX = 'limmiar/note-index-dek/v1|'

// iv(12) || wrapKey body (chave AES-256 de 32 bytes + tag GCM de 16) -- ver
// generateWrappedDek em packages/crypto/src/webcrypto.ts.
const TAMANHO_DEK_EMBRULHADA = 60

declare const marcaChaveIndice: unique symbol

/**
 * Marca de tipo: só `chaveIndiceDaConta` produz este tipo, após confirmar em runtime que a
 * chave tem usages de KEK (wrapKey/unwrapKey) -- uma DEK de paciente não compila aqui.
 */
export type ChaveIndiceBusca = CryptoKey & { readonly [marcaChaveIndice]: true }

export function indiceBuscaAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${NOTE_INDEX_AAD_PREFIX}${accountId}`)
}

export function indiceBuscaDekAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${NOTE_INDEX_DEK_AAD_PREFIX}${accountId}`)
}

/**
 * Porta única de produção de `ChaveIndiceBusca`: recusa em runtime (usages sem
 * wrapKey/unwrapKey) o que a marca de tipo já recusa em compilação.
 */
export function chaveIndiceDaConta(kek: CryptoKey): ChaveIndiceBusca {
  if (!kek.usages.includes('wrapKey') || !kek.usages.includes('unwrapKey')) {
    throw new Error('chaveIndiceDaConta: chave precisa de usages wrapKey e unwrapKey (KEK de conta)')
  }
  return kek as ChaveIndiceBusca
}

function concat(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

/**
 * Sela o índice sob uma DEK fresca por gravação, embrulhada pela KEK da conta -- mesmo
 * padrão de `saveApiKey` (copilot-byok/key-store.ts). Wire format: wrappedDek(60) ||
 * iv(12) || ciphertext || tag(16). A DEK nunca sai desta função.
 */
export async function selarIndice(
  chave: ChaveIndiceBusca,
  accountId: string,
  json: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const { dek, wrapped } = await webcrypto.generateWrappedDek(chave, indiceBuscaDekAad(accountId))
  const ciphertext = await webcrypto.encrypt(dek, json, indiceBuscaAad(accountId))
  return concat(wrapped, ciphertext)
}

/** Inverso de `selarIndice` -- rejeita se `accountId` não bater (as duas AAD) ou se
 *  `chave` não for a KEK que embrulhou a DEK. */
export async function abrirIndice(
  chave: ChaveIndiceBusca,
  accountId: string,
  selado: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const wrapped = selado.slice(0, TAMANHO_DEK_EMBRULHADA)
  const ciphertext = selado.slice(TAMANHO_DEK_EMBRULHADA)
  const dek = await webcrypto.unwrapDek(chave, wrapped, indiceBuscaDekAad(accountId))
  return webcrypto.decrypt(dek, ciphertext, indiceBuscaAad(accountId))
}
