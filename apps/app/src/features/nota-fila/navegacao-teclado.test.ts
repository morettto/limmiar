import { describe, expect, it } from 'vitest'
import { ehAtalhoAssinar, proximoIndice } from './navegacao-teclado'

describe('proximoIndice', () => {
  it('"j" desce um índice', () => {
    expect(proximoIndice(0, 3, 'j')).toBe(1)
  })

  it('"k" sobe um índice', () => {
    expect(proximoIndice(1, 3, 'k')).toBe(0)
  })

  it('no fundo da lista, "j" para (não dá a volta) -- ver README para a decisão', () => {
    expect(proximoIndice(2, 3, 'j')).toBe(2)
  })

  it('no topo da lista, "k" para (não dá a volta)', () => {
    expect(proximoIndice(0, 3, 'k')).toBe(0)
  })

  it('lista vazia devolve o índice inalterado', () => {
    expect(proximoIndice(-1, 0, 'j')).toBe(-1)
    expect(proximoIndice(-1, 0, 'k')).toBe(-1)
  })

  it('tecla irrelevante devolve o índice inalterado', () => {
    expect(proximoIndice(1, 3, 'x')).toBe(1)
  })

  it('sem seleção (índice -1), "j" ou "k" pousam no primeiro item', () => {
    expect(proximoIndice(-1, 3, 'j')).toBe(0)
    expect(proximoIndice(-1, 3, 'k')).toBe(0)
  })
})

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
