import { describe, expect, it } from 'vitest'
import { LIMIAR_MESMA_VOZ, similaridadeCosseno } from './classify.ts'

describe('similaridadeCosseno', () => {
  it('vetores iguais dão 1, ortogonais 0, opostos -1, e a escala não importa', () => {
    expect(similaridadeCosseno([1, 0, 0], [1, 0, 0])).toBe(1)
    expect(similaridadeCosseno([1, 0], [0, 1])).toBe(0)
    expect(similaridadeCosseno([1, 2], [-1, -2])).toBeCloseTo(-1, 12)
    expect(similaridadeCosseno([1, 2], [10, 20])).toBeCloseTo(1, 12)
  })

  it.each([[[], []], [[1], [1, 2]], [[NaN, 0], [1, 0]], [[1, 0], [Infinity, 0]], [[0, 0], [1, 0]], [['1', 0], [1, 0]], [[1, 0], ['1', 0]]])('vetor incompatível ou inválido %j x %j não decide (NaN)', (a, b) => {
    expect(similaridadeCosseno(a as number[], b as number[])).toBeNaN()
  })
})

describe('LIMIAR_MESMA_VOZ', () => {
  it('é 0,5, o mesmo do cadastro de voz no aparelho e do gateway de fala', () => {
    expect(LIMIAR_MESMA_VOZ).toBe(0.5)
  })
})
