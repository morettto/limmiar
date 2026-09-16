import { generateKeyPair, type CryptoKey, webcrypto } from '@limmiar/crypto'
import { obterParDeChaves, publicarParDeChaves, type ParDeChavesSelado } from './api'

const AAD_PREFIX = 'limmiar/chave-x25519/v1|'

function parDeChavesAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${AAD_PREFIX}${accountId}`)
}

async function decifrarPar(
  kek: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
  par: ParDeChavesSelado,
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const dek = await webcrypto.unwrapDek(kek, par.wrappedDek, aad)
  const privateKey = await webcrypto.decrypt(dek, par.sealedPrivateKey, aad)
  return { publicKey: par.publicKey, privateKey }
}

// Idempotente: GET 404 gera e publica; PUT 409 (corrida com outro dispositivo) adota o par do
// servidor em vez do gerado aqui. A privada só viaja pela rede selada (`sealedPrivateKey`).
export async function garantirParDeChaves(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  const aad = parDeChavesAad(p.accountId)
  const existing = await obterParDeChaves(p.baseUrl, p.accountId, p.accessToken)
  if (existing.ok) {
    return decifrarPar(p.kek, aad, existing.par)
  }
  if (existing.code !== 'key_pair.not_found') {
    throw new Error(`garantirParDeChaves: falha ao ler o par (${existing.code})`)
  }

  const keyPair = generateKeyPair()
  const { dek, wrapped } = await webcrypto.generateWrappedDek(p.kek, aad)
  // Re-materialized as Uint8Array<ArrayBuffer>: @noble/curves' keygen() returns a plain
  // Uint8Array<ArrayBufferLike>, one shade wider than what webcrypto.encrypt requires.
  const sealedPrivateKey = await webcrypto.encrypt(dek, new Uint8Array(keyPair.privateKey), aad)
  const published = await publicarParDeChaves(p.baseUrl, p.accountId, p.accessToken, {
    publicKey: keyPair.publicKey,
    wrappedDek: wrapped,
    sealedPrivateKey,
  })
  if (published.ok) {
    return keyPair
  }
  if (published.code !== 'key_pair.public_key_conflict') {
    throw new Error(`garantirParDeChaves: falha ao publicar o par (${published.code})`)
  }

  // 409: outro dispositivo publicou primeiro -- adota o par do servidor em vez do que geramos.
  const afterConflict = await obterParDeChaves(p.baseUrl, p.accountId, p.accessToken)
  if (!afterConflict.ok) {
    throw new Error(`garantirParDeChaves: falha ao ler o par após 409 (${afterConflict.code})`)
  }
  return decifrarPar(p.kek, aad, afterConflict.par)
}
