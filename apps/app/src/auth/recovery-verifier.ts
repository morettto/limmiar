import { deriveKey, type Argon2Params } from '@limmiar/crypto'

// A recovery phrase guards full account access, the same as a password, so it uses the
// same Argon2id params as PASSWORD_VERIFIER_PARAMS (password-verifier.ts).
const RECOVERY_VERIFIER_PARAMS: Argon2Params = {
  memoryKiB: 19456,
  iterations: 2,
  parallelism: 1,
  // The backend rejects any recoveryVerifier whose decoded length isn't exactly 32 bytes,
  // same rule as passwordVerifier.
  dkLen: 32,
}

// The mnemonic must never leave this function's stack frame. Only the derived verifier
// is sent to the backend.
export async function deriveRecoveryVerifier(mnemonic: string, salt: Uint8Array): Promise<Uint8Array> {
  const mnemonicBytes = new TextEncoder().encode(mnemonic)
  return deriveKey(mnemonicBytes, salt, RECOVERY_VERIFIER_PARAMS)
}
