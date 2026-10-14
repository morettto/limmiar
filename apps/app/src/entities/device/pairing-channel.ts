import { deriveChannelKey, getSharedSecret, webcrypto } from '@limmiar/crypto'
import { decodeBase64 } from '../../shared/lib/base64'

export async function preparePairingChannel(privateKey: Uint8Array, publicKey: string, sessionId: string) {
  const peer = decodeBase64(publicKey)
  if (peer.length !== 32) throw new Error('Invalid pairing public key')
  const secret = getSharedSecret(privateKey, peer)
  let channelKey: Uint8Array
  try { channelKey = deriveChannelKey(secret, new TextEncoder().encode(sessionId)) }
  finally { secret.fill(0) }
  // O código depende do segredo compartilhado; trocar uma chave no servidor muda o código.
  const domain = new TextEncoder().encode(`limmiar/pairing-confirmation/v1|${sessionId}|`)
  const input = new Uint8Array(domain.length + channelKey.length)
  input.set(domain)
  input.set(channelKey, domain.length)
  try {
    const digest = await webcrypto.sha256(input)
    const hex = Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    return { channelKey, code: `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)} ${hex.slice(12)}` }
  } catch (error) { channelKey.fill(0); throw error }
  finally { input.fill(0) }
}
