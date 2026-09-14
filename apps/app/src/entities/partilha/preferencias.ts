import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { gravarPreferenciasPartilha, obterPreferenciasPartilha } from './api'
import { comPartilha, type EstadoPartilha, type TipoPartilhavel } from './partilha'

const AAD_PREFIX = 'limmiar/partilha-estado/v1|'
const ULTIMA_VISTA_KEY_PREFIX = 'limmiar:partilha-versao'

export class RollbackDePreferencias extends Error {}

function preferenciasAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${AAD_PREFIX}${accountId}`)
}

function ultimaVistaKey(accountId: string): string {
  return `${ULTIMA_VISTA_KEY_PREFIX}:${accountId}`
}

// Number(null) === 0, então o caso "nunca gravado" já cai fora do ternário.
function lerUltimaVista(accountId: string): number {
  return Number(window.localStorage.getItem(ultimaVistaKey(accountId)))
}

// Só sobe: uma versão igual ou menor do que a já vista não regride o registo local.
function subirUltimaVista(accountId: string, versao: number): void {
  if (versao > lerUltimaVista(accountId)) {
    window.localStorage.setItem(ultimaVistaKey(accountId), String(versao))
  }
}

interface BlobPreferencias {
  versao: number
  estado: EstadoPartilha
}

async function cifrarPreferencias(
  kek: CryptoKey,
  accountId: string,
  versao: number,
  estado: EstadoPartilha,
): Promise<{ wrappedDek: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const aad = preferenciasAad(accountId)
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, aad)
  const plaintext: BlobPreferencias = { versao, estado }
  const ciphertext = await webcrypto.encrypt(dek, new TextEncoder().encode(JSON.stringify(plaintext)), aad)
  return { wrappedDek: wrapped, ciphertext }
}

/**
 * 404 (`sharing.preferences_not_found`) vale estado vazio, versão 0 -- ainda não há destinatários.
 * Qualquer outra falha (rede, 401/403, decifra, rollback) lança: a leitura das preferências é
 * fail-closed, nunca finge um estado.
 */
export async function lerEstadoPartilha(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}): Promise<BlobPreferencias> {
  const resultado = await obterPreferenciasPartilha(p.baseUrl, p.accountId, p.accessToken)
  if (!resultado.ok) {
    if (resultado.code === 'sharing.preferences_not_found') {
      return { versao: 0, estado: {} }
    }
    throw new Error(`lerEstadoPartilha: falha ao ler preferências (${resultado.code})`)
  }

  const aad = preferenciasAad(p.accountId)
  const dek = await webcrypto.unwrapDek(p.kek, resultado.wrappedDek, aad)
  const plaintext = await webcrypto.decrypt(dek, resultado.ciphertext, aad)
  const blob = JSON.parse(new TextDecoder().decode(plaintext)) as BlobPreferencias

  if (blob.versao !== resultado.versao) {
    throw new RollbackDePreferencias('lerEstadoPartilha: a versão autenticada diverge da versão do fio')
  }
  if (blob.versao < lerUltimaVista(p.accountId)) {
    throw new RollbackDePreferencias('lerEstadoPartilha: o servidor devolveu um blob mais antigo do que o já visto')
  }
  subirUltimaVista(p.accountId, blob.versao)
  return blob
}

async function tentarGravar(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  chave: string
  tipo: TipoPartilhavel
  ativa: boolean
}): Promise<{ ok: true; estado: EstadoPartilha } | { ok: false; code: string }> {
  const lido = await lerEstadoPartilha(p)
  const proximoEstado = comPartilha(lido.estado, p.chave, p.tipo, p.ativa)
  const { wrappedDek, ciphertext } = await cifrarPreferencias(p.kek, p.accountId, lido.versao + 1, proximoEstado)
  const gravado = await gravarPreferenciasPartilha(p.baseUrl, p.accountId, p.accessToken, {
    versaoEsperada: lido.versao,
    wrappedDek,
    ciphertext,
  })
  if (!gravado.ok) {
    return { ok: false, code: gravado.code }
  }
  subirUltimaVista(p.accountId, gravado.versao)
  return { ok: true, estado: proximoEstado }
}

/**
 * Lê, aplica `(chave, tipo, ativa)` e grava com `expectedVersion` = versão lida. Um
 * `sharing.version_conflict` relê e reaplica a mesma mudança idempotente uma única vez; um
 * segundo conflito, ou qualquer outra falha de leitura/gravação, lança.
 */
export async function definirPartilha(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  chave: string
  tipo: TipoPartilhavel
  ativa: boolean
}): Promise<EstadoPartilha> {
  const primeira = await tentarGravar(p)
  if (primeira.ok) {
    return primeira.estado
  }
  if (primeira.code !== 'sharing.version_conflict') {
    throw new Error(`definirPartilha: falha ao gravar (${primeira.code})`)
  }

  const segunda = await tentarGravar(p)
  if (segunda.ok) {
    return segunda.estado
  }
  throw new Error(`definirPartilha: conflito de versão persistente (${segunda.code})`)
}
