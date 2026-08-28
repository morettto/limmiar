export { deriveKey, type Argon2Params } from './argon2id'
// __setNonceSourceForTests / __resetNonceSourceForTests are a test-only seam (ADR-S01-02) deliberately not re-exported here, so the public surface never offers control over the nonce.
export { decrypt, encrypt } from './aes-gcm'
export { unwrapDek, wrapDek } from './dek-kek'
export { createKeychain, type Keychain, type KeychainState } from './keychain'
// Curated export below, NOT `export * as webcrypto`, so __setIvSourceForTests / __resetIvSourceForTests (ADR-S01-02 test-only seam, same discipline as aes-gcm.ts) never reach the public surface.
import * as webcryptoInternal from './webcrypto'
export type { WebCryptoKey as CryptoKey } from './webcrypto'
export const webcrypto = {
  importKek: webcryptoInternal.importKek,
  generateWrappedDek: webcryptoInternal.generateWrappedDek,
  unwrapDek: webcryptoInternal.unwrapDek,
  rewrapDek: webcryptoInternal.rewrapDek,
  encrypt: webcryptoInternal.encrypt,
  decrypt: webcryptoInternal.decrypt,
  sha256: webcryptoInternal.sha256,
}
export { generateKeyPair, getPublicKey, getSharedSecret } from './x25519'
export { deriveChannelKey } from './device-pairing-channel'
export {
  type Bip39Strength,
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
} from './bip39'
