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
  // ADR-S01-03: the envelope's AAD (schema version + record id, decided by
  // the caller) binds a wrapped DEK to one context. A wrappedDek unwrapped
  // under a DIFFERENT context's AAD must fail — this is what actually
  // enforces "this patient's DEK doesn't open under that context", even
  // though this ticket doesn't decide the AAD's byte format itself.
  it('fails to unwrap when the AAD does not match the one used to wrap', () => {
    const kek = new Uint8Array(32).fill(0x33)
    const dek = new Uint8Array(32).fill(0x44)
    const wrapAad = new TextEncoder().encode('schema=1;record=patient-A')
    const wrongAad = new TextEncoder().encode('schema=1;record=patient-B')

    const wrapped = wrapDek(kek, dek, wrapAad)

    expect(() => unwrapDek(kek, wrapped, wrongAad)).toThrow()
  })
})
