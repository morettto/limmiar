import { deriveKey, type Argon2Params } from '@limmiar/crypto'

// OWASP Password Storage Cheat Sheet baseline for Argon2id (ASVS L3). Same params as
// packages/crypto's benchmarked KDF calls.
const PASSWORD_VERIFIER_PARAMS: Argon2Params = {
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
  // The backend rejects any passwordVerifier whose decoded length isn't exactly 32 bytes.
  dkLen: 32,
}

// The plaintext password must never leave this function's stack frame. Only the derived
// verifier is sent to the backend.
export async function deriveEmailPasswordVerifier(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password)
  return deriveKey(passwordBytes, salt, PASSWORD_VERIFIER_PARAMS)
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
