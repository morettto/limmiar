import { describe, expect, it } from 'vitest'
import { proximoIndice } from './navegacao-teclado'

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
