import { decrypt, encrypt } from './aes-gcm'

// wrapDek/unwrapDek ARE encrypt/decrypt; the distinct names exist only so call sites read as wrapping a DEK under a KEK, not to add logic.
export function wrapDek(kek: Uint8Array, dek: Uint8Array, aad: Uint8Array): Uint8Array {
  return encrypt(kek, dek, aad)
}

export function unwrapDek(kek: Uint8Array, wrappedDek: Uint8Array, aad: Uint8Array): Uint8Array {
  return decrypt(kek, wrappedDek, aad)
}
