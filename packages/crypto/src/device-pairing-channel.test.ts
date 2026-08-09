import { describe, expect, it } from 'vitest'
import { deriveChannelKey } from './device-pairing-channel'
import { generateKeyPair, getSharedSecret } from './x25519'

describe('deriveChannelKey — two devices derive the same channel key', () => {
  // The real S02-04 pairing flow: the phone and the desktop each hold their
  // own X25519 key pair, exchange public keys over the QR channel, and never
  // transmit the derived key itself. Both sides must land on the same bytes
  // from their own half of the exchange, or the channel simply doesn't work.
  it('derives an identical key on both sides of an X25519 exchange with the same salt', () => {
    const alice = generateKeyPair()
    const bob = generateKeyPair()
    const salt = new TextEncoder().encode('pairing-session=01J8Z0K5')

    const fromAlice = deriveChannelKey(getSharedSecret(alice.privateKey, bob.publicKey), salt)
    const fromBob = deriveChannelKey(getSharedSecret(bob.privateKey, alice.publicKey), salt)

    expect(fromAlice).toEqual(fromBob)
  })
})

describe('deriveChannelKey — the salt binds the key to one pairing session', () => {
  // The caller passes the pairing session id as salt. If two sessions sharing
  // the same ECDH secret derived the same key, a shared secret captured in one
  // session would open the other — this is the test that says they don't.
  it('derives different keys from the same shared secret under different salts', () => {
    const sharedSecret = new Uint8Array(32).fill(0x5a)

    const first = deriveChannelKey(sharedSecret, new TextEncoder().encode('session=A'))
    const second = deriveChannelKey(sharedSecret, new TextEncoder().encode('session=B'))

    expect(first).not.toEqual(second)
  })
})

describe('deriveChannelKey — determinism', () => {
  // HKDF is a pure function of (secret, salt, info, length). Unlike this
  // package's encrypt(), which deliberately hides a CSPRNG nonce inside, this
  // one must have no entropy source of its own — a device that re-derived a
  // different key on a second call could never rejoin its own session.
  it('returns identical bytes when called twice with the same inputs', () => {
    const sharedSecret = new Uint8Array(32).fill(0x77)
    const salt = new TextEncoder().encode('session=C')

    expect(deriveChannelKey(sharedSecret, salt)).toEqual(deriveChannelKey(sharedSecret, salt))
  })
})

describe('deriveChannelKey — output length', () => {
  // aes-gcm.ts rejects anything other than a 32-byte key, so this length is
  // the whole contract between the two modules.
  it('returns exactly 32 bytes, ready for AES-256-GCM', () => {
    const salt = new TextEncoder().encode('session=D')

    const key = deriveChannelKey(new Uint8Array(32).fill(0x01), salt)

    expect(key).toHaveLength(32)
  })
})
