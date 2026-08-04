import { unwrapDek as unwrapDekInternal, wrapDek as wrapDekInternal } from './dek-kek'

export type KeychainState = 'locked' | 'unlocking' | 'unlocked'

export interface Keychain {
  getState(): KeychainState
  unlock(deriveKek: () => Promise<Uint8Array>): Promise<void>
  lock(): void
  wrapDek(dek: Uint8Array, aad: Uint8Array): Uint8Array
  unwrapDek(wrappedDek: Uint8Array, aad: Uint8Array): Uint8Array
}

// Key-vault session state machine: locked (no KEK in memory) -> unlocking
// (KEK derivation in flight) -> unlocked (KEK held, DEKs can be
// wrapped/unwrapped) -> locked again. unlock() takes a callback that
// PRODUCES the KEK rather than a password itself: this package has no ADR
// deciding how e.g. a BIP39 seed or an X25519 shared secret becomes a
// KEK-wrapping key, so the keychain stays agnostic to *how* it's derived —
// that's the caller's call. This also means the FSM never gains an "is this
// password right?" check of its own: the only place a wrong KEK can ever
// surface is later, at unwrapDek's GCM tag check, which is EXACTLY what
// keeps wrong-password and tampered-ciphertext indistinguishable (same
// throw, same code path, same rough cost). Don't add a verification step to
// unlock() — it would break that guarantee.
export function createKeychain(): Keychain {
  let state: KeychainState = 'locked'
  let kek: Uint8Array | null = null

  function getState(): KeychainState {
    return state
  }

  // Deliberately not declared `async function`: the guard clause below must
  // throw synchronously to a caller who doesn't await (a plain try/catch
  // around a bare `keychain.unlock(...)` call) — an async function would
  // instead swallow it into a rejected Promise. The actual derivation and
  // its race handling live in an inner async function so `await` is still
  // available where it's needed.
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

      // lock() may have run while deriveKek() was in flight. If so, state is
      // no longer 'unlocking' (lock() already forced it back to 'locked')
      // and this just-resolved KEK is stale — it must never become live.
      // Zero it in place and leave state exactly as lock() left it.
      if (state !== 'unlocking') {
        derivedKek.fill(0)
        return
      }

      kek = derivedKek
      state = 'unlocked'
    }

    return run()
  }

  // Callable from any state, always succeeds. Zeroing the KEK's actual
  // bytes (not just dropping the reference) is what closes every path to a
  // wrapped DEK's plaintext — including a reference to this same array held
  // outside this module — since the only thing standing between a wrapped
  // DEK and its plaintext is this array's live bytes.
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
    // Invariant: state is 'unlocked' only while kek holds the live KEK set
    // by unlock() above — lock() always clears both together.
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
