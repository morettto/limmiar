import { describe, expect, it } from 'vitest'
import { unwrapDek, wrapDek } from './dek-kek'

describe('wrapDek/unwrapDek — round trip', () => {
  it('unwraps a DEK that was wrapped with the same KEK and AAD', () => {
    const kek = new Uint8Array(32).fill(0x11)
    const dek = new Uint8Array(32).fill(0x22)
    const aad = new TextEncoder().encode('schema=1;record=abc123')

    const wrapped = wrapDek(kek, dek, aad)
    const unwrapped = unwrapDek(kek, wrapped, aad)

    expect(unwrapped).toEqual(dek)
  })
})

describe('wrapDek/unwrapDek — AAD binds the wrapped DEK to its context', () => {
  // ADR-S01-03: the envelope's AAD (schema version + record id) binds a wrapped
  // DEK to one context. Unwrapping under a different AAD must fail — that is what
  // enforces this patient's DEK not opening under another context.
  it('fails to unwrap when the AAD does not match the one used to wrap', () => {
    const kek = new Uint8Array(32).fill(0x33)
    const dek = new Uint8Array(32).fill(0x44)
    const wrapAad = new TextEncoder().encode('schema=1;record=patient-A')
    const wrongAad = new TextEncoder().encode('schema=1;record=patient-B')

    const wrapped = wrapDek(kek, dek, wrapAad)

    expect(() => unwrapDek(kek, wrapped, wrongAad)).toThrow()
  })
})
