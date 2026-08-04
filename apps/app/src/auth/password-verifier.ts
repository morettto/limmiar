import { deriveKey, type Argon2Params } from '@limmiar/crypto'

// OWASP Password Storage Cheat Sheet baseline for Argon2id (ASVS L3),
// already adopted and benchmarked for this repo's KDF calls in S01-01 — see
// packages/crypto/scripts/run-benchmark.mjs and packages/crypto/BENCHMARK.md
// ("Baseline params (OWASP minimum recommendation) ... memoryKiB=19456,
// iterations=2, parallelism=1"). Reused verbatim here rather than picking a
// new set of numbers for this second Argon2id call site.
const PASSWORD_VERIFIER_PARAMS: Argon2Params = {
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
  // AccountService.PasswordVerifierLength (apps/api/src/Api/Accounts/AccountService.cs) --
  // the backend rejects any passwordVerifier whose decoded byte length isn't exactly 32.
  dkLen: 32,
}

// ADR-S02-02: the client derives a password verifier locally via Argon2id and
// sends only that byte string to the backend -- the plaintext password
// itself must never leave this function's stack frame.
export async function deriveEmailPasswordVerifier(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password)
  return deriveKey(passwordBytes, salt, PASSWORD_VERIFIER_PARAMS)
}

// Design note (not a pre-agreed seam, added to satisfy deriveEmailPasswordVerifier's
// `salt` parameter): RegisterRequest/LoginRequest on the backend carry no salt field
// at all (see apps/api/src/Api/Accounts/{Register,Login}Request.cs) and AccountService
// stores the verifier verbatim -- there is nowhere for a server-issued or
// server-stored salt to come from, and login must be able to re-derive the exact
// same verifier from just (email, password) alone, with no round-trip to fetch a
// salt first. A salt derived deterministically from the account's own (normalized)
// e-mail satisfies that constraint: it's still unique per account, and Argon2id
// salts are not required to be secret (see RFC 9106) -- they only need to defeat
// precomputed/rainbow-table attacks shared across accounts, which a per-account
// value still does. Normalization mirrors AccountService.NormalizeEmail
// (trim + lower-invariant) exactly, so register and login always agree on the salt.
export async function deriveEmailSalt(email: string): Promise<Uint8Array> {
  const normalized = email.trim().toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return new Uint8Array(digest)
}
