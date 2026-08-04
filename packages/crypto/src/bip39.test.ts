import { readFileSync } from 'node:fs'
import { bytesToHex, hexToBytes } from '@noble/ciphers/utils.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type Bip39Strength,
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
} from './bip39'

// Official BIP39 reference vectors — Trezor `python-mnemonic` vectors.json
// ("english" list), https://github.com/trezor/python-mnemonic/blob/master/vectors.json
// One vector per entropy length actually present in that file (16/24/32
// bytes = 128/192/256 bits). Downloaded raw and read verbatim (not via an
// AI-summarized fetch, to avoid hex transcription risk), then cross-checked
// byte-for-byte against the installed @scure/bip39 output (entropy roundtrip
// and seed, passphrase "TREZOR" per that vector set) before being hardcoded
// here.
const TREZOR_VECTORS = [
  {
    entropy: '00000000000000000000000000000000',
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    seed: 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
  },
  {
    entropy: '808080808080808080808080808080808080808080808080',
    mnemonic:
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always',
    seed: '107d7c02a5aa6f38c58083ff74f04c607c2d2c0ecc55501dadd72d025b751bc27fe913ffb796f841c49b1d33b610cf0e91d3aa239027f5e99fe4ce9e5088cd65',
  },
  {
    entropy: '68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c',
    mnemonic:
      'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length',
    seed: '64c87cde7e12ecf6704ab95bb1408bef047c22db4cc7491c4271d170a1b213d20b385bc1588d9c7b38f1b39d415665b8a9030c9ec653d75e65f847d8fc1fc440',
  },
]

describe.each(TREZOR_VECTORS)(
  'Trezor vectors.json known-answer test — %s bytes',
  ({ entropy, mnemonic, seed }) => {
    it('entropyToMnemonic matches the official mnemonic', () => {
      expect(entropyToMnemonic(hexToBytes(entropy))).toBe(mnemonic)
    })

    it('mnemonicToEntropy recovers the official entropy', () => {
      expect(bytesToHex(mnemonicToEntropy(mnemonic))).toBe(entropy)
    })

    it('mnemonicToSeed matches the official seed (passphrase "TREZOR")', async () => {
      const result = await mnemonicToSeed(mnemonic, 'TREZOR')
      expect(bytesToHex(result)).toBe(seed)
    })
  },
)

describe('mnemonicToEntropy / validateMnemonic — invalid checksum rejected', () => {
  const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  // Same 11 "abandon" words as the vector above, last word swapped for
  // another valid wordlist word that does not satisfy this entropy's
  // checksum — verified against the installed @scure/bip39
  // (mnemonicToEntropy throws Error("Invalid checksum")) before hardcoding.
  const brokenChecksum = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo'

  it('sanity: the unmodified vector is valid', () => {
    expect(validateMnemonic(valid)).toBe(true)
  })

  it('mnemonicToEntropy throws on a checksum mismatch', () => {
    expect(() => mnemonicToEntropy(brokenChecksum)).toThrow('Invalid checksum')
  })

  it('validateMnemonic returns false on a checksum mismatch', () => {
    expect(validateMnemonic(brokenChecksum)).toBe(false)
  })
})

describe('mnemonicToSeed — determinism', () => {
  it('returns identical bytes for identical mnemonic and passphrase across two independent calls', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    const [a, b] = await Promise.all([mnemonicToSeed(mnemonic, 'same passphrase'), mnemonicToSeed(mnemonic, 'same passphrase')])

    expect(a).toEqual(b)
  })

  it('defaults the passphrase to the empty string when omitted', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    const [withDefault, withExplicitEmpty] = await Promise.all([
      mnemonicToSeed(mnemonic),
      mnemonicToSeed(mnemonic, ''),
    ])

    expect(withDefault).toEqual(withExplicitEmpty)
  })
})

describe('entropyToMnemonic / mnemonicToEntropy — roundtrip property', () => {
  it('recovers the original entropy, for every valid BIP39 entropy length', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(16, 20, 24, 28, 32)
          .chain((length) => fc.uint8Array({ minLength: length, maxLength: length })),
        (entropy) => {
          const mnemonic = entropyToMnemonic(entropy)
          const recovered = mnemonicToEntropy(mnemonic)

          expect(recovered).toEqual(entropy)
        },
      ),
    )
  })
})

describe('generateMnemonic — property', () => {
  it('always produces a phrase validateMnemonic accepts, with the word count matching the strength, for every valid strength', () => {
    fc.assert(
      fc.property(fc.constantFrom<Bip39Strength>(128, 160, 192, 224, 256), (strengthBits) => {
        const mnemonic = generateMnemonic(strengthBits)

        expect(validateMnemonic(mnemonic)).toBe(true)
        expect(mnemonic.split(' ')).toHaveLength((strengthBits / 32) * 3)
      }),
    )
  })

  it('returns different phrases on successive calls', () => {
    const a = generateMnemonic(128)
    const b = generateMnemonic(128)

    expect(a).not.toBe(b)
  })
})

describe('generateMnemonic — invalid strength (library-enforced)', () => {
  // Bip39Strength is a literal union covering the full BIP39 domain, so
  // TypeScript already rejects every invalid value at compile time — see
  // bip39.ts. This test locks in @scure/bip39's own runtime rejection for a
  // caller that bypasses the type system, instead of adding an unreachable
  // guard of our own (same discipline as the X25519 all-zero peer-key test
  // in x25519.test.ts).
  it('throws for a strength not on the BIP39 union, via the underlying library', () => {
    expect(() => generateMnemonic(100 as Bip39Strength)).toThrow('Invalid entropy')
  })
})

describe('bip39.ts — no serialization/logging of the recovery phrase (static guard, same pattern as the argon2idAsync guard in S01-01)', () => {
  it('the source never calls console.* or JSON.stringify', () => {
    const source = readFileSync(new URL('./bip39.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/console\./)
    expect(source).not.toMatch(/JSON\.stringify/)
  })
})

describe('mnemonicToEntropy — error messages never echo the input phrase', () => {
  it('always throws, and never includes the invalid input string in the thrown message, for arbitrary invalid input', () => {
    // minLength 24 is deliberate, not arbitrary: every reachable error
    // message from this call ("Invalid mnemonic", "invalid entropy length",
    // "Invalid checksum") is at most 23 characters, so a message can never
    // contain a 24+ character input as a substring — this keeps the
    // assertion a real leak guard instead of a coincidental short-string
    // collision (e.g. a 1-character input like " " is trivially "contained"
    // in "Invalid mnemonic" without anything actually leaking).
    fc.assert(
      fc.property(fc.string({ minLength: 24, maxLength: 200 }), (input) => {
        let thrown: unknown
        try {
          mnemonicToEntropy(input)
        } catch (error) {
          thrown = error
        }

        expect(thrown).toBeInstanceOf(Error)
        expect((thrown as Error).message).not.toContain(input)
      }),
    )
  })

  it('does not include the invalid mnemonic string in the thrown error for a well-formed but wrong-checksum phrase', () => {
    const brokenChecksum = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo'

    let thrown: unknown
    try {
      mnemonicToEntropy(brokenChecksum)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).not.toContain(brokenChecksum)
  })
})
