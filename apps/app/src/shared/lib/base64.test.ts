import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64 } from './base64'

describe('encodeBase64 / decodeBase64', () => {
  it('round-trips arbitrary bytes, including NUL and 0xFF', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f, 0xc3, 0x28])
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
  })

  it('round-trips a realistic 32-byte key', () => {
    const bytes = new Uint8Array(32).fill(0x5a)
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
  })

  it('produces a string with no padding surprises for empty input', () => {
    expect(decodeBase64(encodeBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0))
  })
})
