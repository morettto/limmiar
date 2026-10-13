import { describe, expect, it } from 'vitest'
import { DIMENSOES_VOZ, embeddingValido, MODELO_VOZ } from './modelo'

const valido = () => new Array<number>(DIMENSOES_VOZ).fill(0.1)

describe('modelo de identidade de voz', () => {
  it('fixa a versão do modelo pelo seu resumo SHA-256 e as dimensões do vetor', () => {
    expect(MODELO_VOZ).toBe('d51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77')
    expect(DIMENSOES_VOZ).toBe(192)
  })

  it('aceita só um vetor de 192 números finitos em precisão simples e de norma positiva', () => {
    expect(embeddingValido(valido())).toBe(true)
  })

  it.each([
    ['não é lista', 'x'],
    ['tamanho errado', new Array(191).fill(0.1)],
    ['um NaN no meio de valores bons', [...valido().slice(1), Number.NaN]],
    ['um infinito no meio de valores bons', [...valido().slice(1), Number.POSITIVE_INFINITY]],
    ['um valor que estoura a precisão simples', [...valido().slice(1), 1e40]],
    ['um texto numérico no meio de valores bons', [...valido().slice(1), '0.1']],
    ['um booleano no meio de valores bons', [...valido().slice(1), true]],
    ['norma zero', new Array(192).fill(0)],
  ])('recusa vetor com %s', (_caso, embedding) => {
    expect(embeddingValido(embedding)).toBe(false)
  })
})
