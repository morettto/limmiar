import { deriveKey } from '@limmiar/crypto'
import { ACCOUNT_VERIFIER_PARAMS } from './argon2-params'

// The plaintext password must never leave this function's stack frame. Only the derived
// verifier is sent to the backend.
export async function deriveEmailPasswordVerifier(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password)
  return deriveKey(passwordBytes, salt, ACCOUNT_VERIFIER_PARAMS)
}

// The backend stores no salt and login must re-derive the verifier from (email, password) with
// no round trip, so the salt is derived from the normalized email — unique per account, and
// Argon2id salts need not be secret (RFC 9106). Normalization must match AccountService exactly.
export async function deriveEmailSalt(email: string): Promise<Uint8Array> {
  const normalized = email.trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return new Uint8Array(digest)
}
