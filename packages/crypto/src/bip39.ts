import {
  entropyToMnemonic as scureEntropyToMnemonic,
  generateMnemonic as scureGenerateMnemonic,
  mnemonicToEntropy as scureMnemonicToEntropy,
  mnemonicToSeed as scureMnemonicToSeed,
  validateMnemonic as scureValidateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

// ADR-S01-05: same actively-maintained, audited @scure/@noble family already
// used for Argon2id, AES-GCM and X25519 in this package. English-only
// wordlist for now — other BIP39 languages are out of this ticket's scope.
export type Bip39Strength = 128 | 160 | 192 | 224 | 256

// Unlike Argon2Params (plain `number` fields, so out-of-range values are
// invisible to the type checker and need a runtime guard of their own — see
// argon2id.ts), Bip39Strength is a literal union covering the full BIP39
// domain: TypeScript itself already rejects every invalid value at compile
// time, so there is no business rule left for a runtime guard to add. A
// caller can still reach an invalid value only by bypassing the type system
// (e.g. `as any`), in which case @scure/bip39's own RangeError already fails
// closed — see the "invalid strength" test locking that library behavior in,
// same discipline as the X25519 all-zero peer-key guard.
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

// BIP39 seed derivation is deliberately independent from checksum validation
// (spec behavior, not a gap): mnemonicToSeed never verifies the mnemonic's
// checksum or wordlist membership. Reject invalid mnemonics before deriving
// a seed with mnemonicToEntropy/validateMnemonic first.
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Promise<Uint8Array> {
  return scureMnemonicToSeed(mnemonic, passphrase)
}
