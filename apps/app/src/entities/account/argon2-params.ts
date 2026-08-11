import type { Argon2Params } from '@limmiar/crypto'

// OWASP Password Storage Cheat Sheet baseline for Argon2id (ASVS L3). Shared by both the
// password verifier and the recovery-phrase verifier: a recovery phrase guards full account
// access, the same as a password, so both derive with identical parameters.
export const ACCOUNT_VERIFIER_PARAMS: Argon2Params = {
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
  // The backend rejects any verifier whose decoded length isn't exactly 32 bytes.
  dkLen: 32,
}
