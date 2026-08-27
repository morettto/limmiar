import { deriveKey } from '@limmiar/crypto'
import { ACCOUNT_VERIFIER_PARAMS } from './argon2-params'

// The plaintext password must never leave this function's stack frame. Only the derived
// verifier is sent to the backend.
export async function deriveEmailPasswordVerifier(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password)
  return deriveKey(passwordBytes, salt, ACCOUNT_VERIFIER_PARAMS)
}

// The backend stores no salt and login must re-derive the same verifier from just
// (email, password), with no round trip to fetch one first. A salt derived
// deterministically from the normalized email is still unique per account; Argon2id
// salts do not need to be secret (RFC 9106), only unique enough to defeat rainbow
// tables shared across accounts. Normalization must match AccountService.NormalizeEmail
// exactly, so register and login agree on the salt.
export async function deriveEmailSalt(email: string): Promise<Uint8Array> {
  const normalized = email.trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return new Uint8Array(digest)
}
