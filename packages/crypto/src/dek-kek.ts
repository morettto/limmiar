import { decrypt, encrypt } from './aes-gcm'

// Thin semantic layer over aes-gcm.ts: wrapDek/unwrapDek ARE encrypt/decrypt.
// The distinct names exist only so call sites that handle a per-patient DEK
// wrapped by a professional's KEK read as what they mean, not to add logic.
export function wrapDek(kek: Uint8Array, dek: Uint8Array, aad: Uint8Array): Uint8Array {
  return encrypt(kek, dek, aad)
}

export function unwrapDek(kek: Uint8Array, wrappedDek: Uint8Array, aad: Uint8Array): Uint8Array {
  return decrypt(kek, wrappedDek, aad)
}
