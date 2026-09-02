import { describe, expect, it } from 'vitest'
import { deriveChannelKey } from './device-pairing-channel'
import { generateKeyPair, getSharedSecret } from './x25519'

describe('deriveChannelKey — two devices derive the same channel key', () => {
  // The real S02-04 flow: each side holds its own X25519 pair, they exchange public
  // keys over the QR channel, and the derived key is never transmitted. Both sides
  // must land on the same bytes or the channel does not work.
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
  // HKDF is a pure function of (secret, salt, info, length) — unlike encrypt(),
  // which hides a CSPRNG nonce. A device that re-derived a different key on a
  // second call could never rejoin its own session.
  it('returns identical bytes when called twice with the same inputs', () => {
    const sharedSecret = new Uint8Array(32).fill(0x77)
    const salt = new TextEncoder().encode('session=C')

    expect(deriveChannelKey(sharedSecret, salt)).toEqual(deriveChannelKey(sharedSecret, salt))
  })
})

describe('deriveChannelKey — known-answer test', () => {
  it('matches the precomputed HKDF-SHA256 output for a fixed secret and salt', () => {
    const secret = new Uint8Array(32).fill(0x01)
    const salt = new TextEncoder().encode('session=known-answer-test')

    const key = deriveChannelKey(secret, salt)

    expect(Buffer.from(key).toString('hex')).toBe(
      '2f3e092d5f3054ba4e9b268ec3c17db219301653df5307b06e2c7521b2155ebe',
    )
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
