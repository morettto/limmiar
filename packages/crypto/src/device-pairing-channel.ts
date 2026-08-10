import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

// HKDF `info` domain-separates this channel key from any other key derived from the same X25519 exchange; the `-v1` suffix must be bumped, never edited in place, so a future derivation change coexists with deployed devices instead of silently changing the key under the same name.
const CHANNEL_KEY_INFO = new TextEncoder().encode('limmiar-device-pairing-channel-v1')

// Mirrors aes-gcm.ts's AES_256_KEY_LENGTH, restated rather than imported since that constant is module-private there; this output feeds directly into that module's encrypt/decrypt, which reject any other length.
const CHANNEL_KEY_LENGTH = 32

// getSharedSecret's raw output is a curve point coordinate, not uniformly random, and must never be handed to a symmetric cipher directly — HKDF-SHA256 turns it into a uniform key. `salt` is the pairing session id, so a shared secret replayed into a different session cannot open that session's traffic.
export function deriveChannelKey(sharedSecret: Uint8Array, salt: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, salt, CHANNEL_KEY_INFO, CHANNEL_KEY_LENGTH)
}
