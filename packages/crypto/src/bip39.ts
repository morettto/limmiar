import {
  entropyToMnemonic as scureEntropyToMnemonic,
  generateMnemonic as scureGenerateMnemonic,
  mnemonicToEntropy as scureMnemonicToEntropy,
  mnemonicToSeed as scureMnemonicToSeed,
  validateMnemonic as scureValidateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

// ADR-S01-05: same audited @scure/@noble family as Argon2id, AES-GCM and X25519 in this package; English-only wordlist, other BIP39 languages are out of scope for now.
export type Bip39Strength = 128 | 160 | 192 | 224 | 256

// Unlike Argon2Params, Bip39Strength is a literal union TypeScript already rejects invalid values for at compile time, so there is no runtime guard here (unlike argon2id.ts); a value that bypasses the type system still fails closed via @scure/bip39's own RangeError.
export function generateMnemonic(strengthBits: Bip39Strength): string {
  return scureGenerateMnemonic(wordlist, strengthBits)
}

export function mnemonicToEntropy(mnemonic: string): Uint8Array {
  return scureMnemonicToEntropy(mnemonic, wordlist)
}

export function entropyToMnemonic(entropy: Uint8Array): string {
  return scureEntropyToMnemonic(entropy, wordlist)
}

export function validateMnemonic(mnemonic: string): boolean {
  return scureValidateMnemonic(mnemonic, wordlist)
}

// mnemonicToSeed never verifies the mnemonic's checksum or wordlist membership (BIP39 spec behavior, not a gap): validate with validateMnemonic/mnemonicToEntropy before calling this.
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Promise<Uint8Array> {
  return scureMnemonicToSeed(mnemonic, passphrase)
}
