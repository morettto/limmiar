export { deriveKey, type Argon2Params } from './argon2id'
// __setNonceSourceForTests / __resetNonceSourceForTests are a test-only seam
// (ADR-S01-02) — deliberately not re-exported here, so the package's public
// surface never offers a way to control the nonce.
export { decrypt, encrypt } from './aes-gcm'
export { unwrapDek, wrapDek } from './dek-kek'
export { createKeychain, type Keychain, type KeychainState } from './keychain'
// __setIvSourceForTests / __resetIvSourceForTests are a test-only seam
// (ADR-S01-02, same discipline as aes-gcm.ts's nonce seam above) — curated
// export below on purpose, NOT `export * as webcrypto`, so those two never
// reach the package's public surface.
import * as webcryptoInternal from './webcrypto'
export type { WebCryptoKey as CryptoKey } from './webcrypto'
export const webcrypto = {
  importKek: webcryptoInternal.importKek,
  generateWrappedDek: webcryptoInternal.generateWrappedDek,
  unwrapDek: webcryptoInternal.unwrapDek,
  rewrapDek: webcryptoInternal.rewrapDek,
  encrypt: webcryptoInternal.encrypt,
  decrypt: webcryptoInternal.decrypt,
}
export { generateKeyPair, getPublicKey, getSharedSecret } from './x25519'
export {
  type Bip39Strength,
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
} from './bip39'
