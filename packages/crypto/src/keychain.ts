import { unwrapDek as unwrapDekInternal, wrapDek as wrapDekInternal } from './dek-kek'

export type KeychainState = 'locked' | 'unlocking' | 'unlocked'

export interface Keychain {
  getState(): KeychainState
  unlock(deriveKek: () => Promise<Uint8Array>): Promise<void>
  lock(): void
  wrapDek(dek: Uint8Array, aad: Uint8Array): Uint8Array
  unwrapDek(wrappedDek: Uint8Array, aad: Uint8Array): Uint8Array
}

// State machine: locked -> unlocking -> unlocked -> locked. unlock() takes a callback that PRODUCES the KEK, keeping the keychain agnostic to how it's derived (BIP39 seed, X25519 secret, etc). Do not add an "is this KEK right?" check to unlock(): a wrong KEK must surface only later, at unwrapDek's GCM tag check, so wrong-password and tampered-ciphertext stay indistinguishable (same throw, same path, same cost).
export function createKeychain(): Keychain {
  let state: KeychainState = 'locked'
  let kek: Uint8Array | null = null

  function getState(): KeychainState {
    return state
  }

  // Deliberately not `async function`: the guard clause below must throw synchronously for a caller who doesn't await (plain try/catch around a bare call), not swallow into a rejected Promise; the inner async run() handles derivation and its race.
  function unlock(deriveKek: () => Promise<Uint8Array>): Promise<void> {
    if (state !== 'locked') {
      throw new Error(`cannot unlock keychain while it is "${state}"`)
    }
    state = 'unlocking'

    const run = async (): Promise<void> => {
      let derivedKek: Uint8Array
      try {
        derivedKek = await deriveKek()
      } catch (error) {
        state = 'locked'
        throw error
      }

      // lock() may have run while deriveKek() was in flight; if state is no longer 'unlocking', this just-resolved KEK is stale and must never become live.
      if (state !== 'unlocking') {
        derivedKek.fill(0)
        return
      }

      kek = derivedKek
      state = 'unlocked'
    }

    return run()
  }

  // Zeroing the KEK's actual bytes (not just dropping the reference) closes every path to a wrapped DEK's plaintext, including a reference to this same array held outside this module.
  function lock(): void {
    if (kek !== null) {
      kek.fill(0)
      kek = null
    }
    state = 'locked'
  }

  function requireUnlockedKek(action: 'wrap' | 'unwrap'): Uint8Array {
    if (state !== 'unlocked') {
      throw new Error(`cannot ${action} DEK while keychain is "${state}"`)
    }
    // Invariant: state is 'unlocked' only while kek holds the live KEK; lock() always clears both together.
    return kek as Uint8Array
  }

  function wrapDek(dek: Uint8Array, aad: Uint8Array): Uint8Array {
    return wrapDekInternal(requireUnlockedKek('wrap'), dek, aad)
  }

  function unwrapDek(wrappedDek: Uint8Array, aad: Uint8Array): Uint8Array {
    return unwrapDekInternal(requireUnlockedKek('unwrap'), wrappedDek, aad)
  }

  return { getState, unlock, lock, wrapDek, unwrapDek }
}
