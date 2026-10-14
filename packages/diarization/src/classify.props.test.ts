import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { similaridadeCosseno } from './classify.ts'

// Vetor não-nulo de dimensão fixa: o cosseno de um vetor nulo (0/0) não é uma entrada real de embedding.
const arbVetor = fc.array(fc.integer({ min: -10, max: 10 }), { minLength: 3, maxLength: 3 }).filter((v) => v.some((x) => x !== 0))

describe('similaridadeCosseno — propriedades', () => {
  it('é simétrica e fica em [-1, 1]', () => {
    fc.assert(fc.property(arbVetor, arbVetor, (a, b) => {
      const s = similaridadeCosseno(a, b)
      expect(s).toBeCloseTo(similaridadeCosseno(b, a), 12)
      expect(Math.abs(s)).toBeLessThanOrEqual(1 + 1e-12)
    }))
  })

  it('escalar um dos vetores por k > 0 não muda o resultado', () => {
    fc.assert(fc.property(arbVetor, arbVetor, fc.double({ min: 0.01, max: 100, noNaN: true }), (a, b, k) => {
      expect(similaridadeCosseno(a, b.map((x) => x * k))).toBeCloseTo(similaridadeCosseno(a, b), 9)
    }))
  })
})
