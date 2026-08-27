import { deriveKey } from '@limmiar/crypto'
import { ACCOUNT_VERIFIER_PARAMS } from './argon2-params'

// The mnemonic must never leave this function's stack frame. Only the derived verifier
// is sent to the backend.
export async function deriveRecoveryVerifier(mnemonic: string, salt: Uint8Array): Promise<Uint8Array> {
  const mnemonicBytes = new TextEncoder().encode(mnemonic)
  return deriveKey(mnemonicBytes, salt, ACCOUNT_VERIFIER_PARAMS)
}
