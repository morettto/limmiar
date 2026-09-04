import { createHmac } from 'node:crypto'
import { expect } from '@playwright/test'

// Moved out of account-recovery.spec.ts (S18-02): logout.spec.ts needs the same TOTP math to
// drive a Professional's real authenticator side of registration -- pure git-mv of the two
// functions, no logic rewrite.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char)
    expect(value, `invalid base32 character in TOTP secret: ${char}`).toBeGreaterThanOrEqual(0)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP (SHA-1, 30s step, 6 digits) -- this repo has no JS/TS TOTP library dependency, so this is a small, self-contained implementation for driving the real authenticator side of the flow in tests. */
export function computeTotpCode(secretBase32: string, epochSeconds: number): string {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(epochSeconds / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const truncated =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  return (truncated % 1_000_000).toString().padStart(6, '0')
}
