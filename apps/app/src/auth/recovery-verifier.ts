import { deriveKey, type Argon2Params } from '@limmiar/crypto'

// S02-06: the recovery phrase (a BIP39 mnemonic, see @limmiar/crypto's bip39.ts) is
// verified the exact same way a password is (ADR-S02-02) -- the client derives a
// verifier locally via Argon2id and sends only that byte string to the backend, never
// the mnemonic itself. Same baseline params as PASSWORD_VERIFIER_PARAMS
// (password-verifier.ts): OWASP Password Storage Cheat Sheet's Argon2id minimum
// (ASVS L3), already benchmarked for this repo's KDF calls in S01-01 -- see
// packages/crypto/scripts/run-benchmark.mjs and packages/crypto/BENCHMARK.md. A
// recovery phrase guards the exact same thing a password does (full account access),
// so there is no reason for it to get a weaker derivation.
const RECOVERY_VERIFIER_PARAMS: Argon2Params = {
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
  // AccountService.RecoveryVerifierLength (apps/api/src/Api/Accounts/AccountService.cs) --
  // the backend rejects any recoveryVerifier whose decoded byte length isn't exactly 32,
  // same rule as passwordVerifier.
  dkLen: 32,
}

// Deliberately parallel to deriveEmailPasswordVerifier (password-verifier.ts): the
// mnemonic never leaves this function's stack frame, only the derived verifier does.
export async function deriveRecoveryVerifier(mnemonic: string, salt: Uint8Array): Promise<Uint8Array> {
  const mnemonicBytes = new TextEncoder().encode(mnemonic)
  return deriveKey(mnemonicBytes, salt, RECOVERY_VERIFIER_PARAMS)
}
