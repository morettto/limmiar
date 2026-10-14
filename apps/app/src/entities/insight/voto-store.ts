import { type CryptoKey, webcrypto } from '@limmiar/crypto'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'

export type Voto = 'util' | 'nao_util'

/** Contrato de docs/juiz-ciclo-de-treino.md seção 1: o corpo enviado ao servidor. */
export interface EventoVoto {
  v: 1
  consentiu: boolean
  usuario: string
  fala: string
  contexto: string[]
  trecho: string
  obra: string
  voto: Voto
  juiz: string
  em: string
}

/** `enviado` só existe no aparelho; nunca vai no corpo da requisição. */
export type VotoGuardado = EventoVoto & { enviado: boolean }

export const VOTO_STORAGE_KEY_PREFIX = 'limmiar:voto-insight'
const AAD_PREFIX = 'limmiar/voto-insight/v1|'

function assertAccountId(accountId: string): void {
  if (accountId === '') throw new Error('voto-store: accountId must not be empty')
}

const storageKeyFor = (accountId: string) => `${VOTO_STORAGE_KEY_PREFIX}:${accountId}`
const votoAad = (accountId: string) => new TextEncoder().encode(`${AAD_PREFIX}${accountId}`)

/** Pseudônimo estável: nunca o id da conta nem o e-mail. */
export async function pseudonimoDaConta(accountId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`limmiar/voto-insight/usuario|${accountId}`))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function lerVotos(kek: CryptoKey, accountId: string): Promise<VotoGuardado[]> {
  assertAccountId(accountId)
  const raw = window.localStorage.getItem(storageKeyFor(accountId))
  if (raw === null) return []
  const stored = JSON.parse(raw) as { wrappedDek: string; ciphertext: string }
  const aad = votoAad(accountId)
  const dek = await webcrypto.unwrapDek(kek, decodeBase64(stored.wrappedDek), aad)
  const plaintext = await webcrypto.decrypt(dek, decodeBase64(stored.ciphertext), aad)
  return JSON.parse(new TextDecoder().decode(plaintext)) as VotoGuardado[]
}

// Ler-e-regravar é assíncrono; sem fila, voto e marca de envio simultâneos perderiam um ao outro.
let fila: Promise<unknown> = Promise.resolve()
const serializar = <T>(tarefa: () => Promise<T>): Promise<T> => {
  const proxima = fila.then(tarefa)
  fila = proxima.catch(() => {})
  return proxima
}

async function gravar(kek: CryptoKey, accountId: string, votos: VotoGuardado[]): Promise<void> {
  const aad = votoAad(accountId)
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, aad)
  const ciphertext = await webcrypto.encrypt(dek, new TextEncoder().encode(JSON.stringify(votos)), aad)
  window.localStorage.setItem(storageKeyFor(accountId), JSON.stringify({ wrappedDek: encodeBase64(wrapped), ciphertext: encodeBase64(ciphertext) }))
}

/** Um envelope por conta com todos os votos; o voto novo na mesma fala e trecho substitui o anterior. */
export async function guardarVoto(kek: CryptoKey, accountId: string,
  entrada: Pick<EventoVoto, 'fala' | 'contexto' | 'trecho' | 'obra' | 'voto' | 'juiz'>, consentiu: boolean, agora = new Date()): Promise<void> {
  assertAccountId(accountId)
  return serializar(async () => {
    const evento: VotoGuardado = { v: 1, consentiu, usuario: await pseudonimoDaConta(accountId), ...entrada, em: agora.toISOString(), enviado: false }
    const existentes = await lerVotos(kek, accountId)
    await gravar(kek, accountId, [...existentes.filter((voto) => voto.fala !== evento.fala || voto.trecho !== evento.trecho), evento])
  })
}

/** Marca como enviado o evento exato (`em` distingue um voto já substituído por outro). */
export async function marcarEnviado(kek: CryptoKey, accountId: string, enviado: EventoVoto): Promise<void> {
  return serializar(async () => {
    const votos = await lerVotos(kek, accountId)
    await gravar(kek, accountId, votos.map((voto) => voto.fala === enviado.fala && voto.trecho === enviado.trecho && voto.em === enviado.em ? { ...voto, enviado: true } : voto))
  })
}
