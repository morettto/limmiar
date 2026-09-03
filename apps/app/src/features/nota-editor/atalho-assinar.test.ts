import { describe, expect, it } from 'vitest'
import { ehAtalhoAssinar } from './atalho-assinar'

describe('ehAtalhoAssinar', () => {
  it('Cmd+Enter (metaKey) conta -- ⌘↵ no Mac', () => {
    expect(ehAtalhoAssinar({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true)
  })

  it('Ctrl+Enter (ctrlKey) conta -- Ctrl+↵ fora do Mac', () => {
    expect(ehAtalhoAssinar({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true)
  })

  it('Enter sozinho, sem modificador, não conta', () => {
    expect(ehAtalhoAssinar({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false)
  })

  it('modificador sem Enter não conta', () => {
    expect(ehAtalhoAssinar({ key: 'a', metaKey: true, ctrlKey: true })).toBe(false)
  })
})
