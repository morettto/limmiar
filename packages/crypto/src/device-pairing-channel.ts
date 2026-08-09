import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

// Fixed HKDF `info` (RFC 5869 §3.2 "context and application specific
// information"): it domain-separates this channel key from any other key ever
// derived from the same X25519 exchange. The `-v1` suffix is what lets a
// future change of this derivation coexist with deployed devices instead of
// silently producing a different key under the same name — bump it, never
// edit it in place.
const CHANNEL_KEY_INFO = new TextEncoder().encode('limmiar-device-pairing-channel-v1')

// 32 bytes, mirroring aes-gcm.ts's own AES_256_KEY_LENGTH (module-private
// there on purpose, so it is restated rather than imported): this output is
// fed straight into that module's encrypt/decrypt, which reject any other
// length.
const CHANNEL_KEY_LENGTH = 32

/**
 * Derives the AES-256-GCM key for one device-pairing channel from a raw
 * X25519 ECDH shared secret.
 *
 * The raw output of `getSharedSecret` is a curve point coordinate, not a
 * uniformly random string — its bits are biased and it must never be handed
 * to a symmetric cipher directly. HKDF-SHA256 (RFC 5869) is the extract-then-
 * expand step that turns it into a uniform 32-byte key.
 *
 * `salt` is the pairing session id: binding the derivation to it means the
 * key belongs to exactly one pairing attempt, so a shared secret replayed
 * into a different session cannot open that session's traffic.
 */
export function deriveChannelKey(sharedSecret: Uint8Array, salt: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, salt, CHANNEL_KEY_INFO, CHANNEL_KEY_LENGTH)
}
