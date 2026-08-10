import { x25519 } from '@noble/curves/ed25519.js'

// ADR-S01-05: same audited @noble family as Argon2id and AES-GCM; cross-checked against RFC 7748's own test vectors in x25519.test.ts.
// @noble/curves' keygen() returns { secretKey, publicKey }; renamed to privateKey here to match RFC 7748 and this package's own vocabulary (getPublicKey/getSharedSecret below both say "privateKey" too).
export function generateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const { secretKey, publicKey } = x25519.keygen()
  return { privateKey: secretKey, publicKey }
}

export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey)
}

export function getSharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, peerPublicKey)
}
