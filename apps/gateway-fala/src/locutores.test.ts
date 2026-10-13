import { describe, expect, it } from 'vitest'
import { Locutores } from './locutores.ts'

const eixo = (i: number, outro = -1, peso = 0) => Array.from({ length: 6 }, (_, k) => (k === i ? 1 : k === outro ? peso : 0))

describe('Locutores', () => {
  it('reconhece o profissional pela impressão de voz, sem exigir vetor normalizado', () => {
    const locutores = new Locutores(eixo(0).map((valor) => valor * 7))
    expect(locutores.identificar(eixo(0).map((valor) => valor * 0.3))).toBe('profissional')
    expect(locutores.identificar(Float32Array.from(eixo(0, 1, 0.5)))).toBe('profissional')
  })

  it('chama de paciente a primeira voz que não casa', () => {
    const locutores = new Locutores(eixo(0))
    expect(locutores.identificar(eixo(1))).toBe('paciente')
    expect(locutores.identificar(eixo(1, 0, 0.4))).toBe('paciente')
  })

  it('agrupa as demais vozes por similaridade e numera as novas', () => {
    const locutores = new Locutores(eixo(0))
    expect(locutores.identificar(eixo(1))).toBe('paciente')
    expect(locutores.identificar(eixo(2))).toBe('pessoa_2')
    expect(locutores.identificar(eixo(3))).toBe('pessoa_3')
    expect(locutores.identificar(eixo(2, 1, 0.3))).toBe('pessoa_2')
    expect(locutores.identificar(eixo(1, 3, 0.2))).toBe('paciente')
    expect(locutores.identificar(eixo(3))).toBe('pessoa_3')
  })

  it('esquece o perfil e as vozes ao limpar', () => {
    const locutores = new Locutores(eixo(0))
    locutores.identificar(eixo(1))
    locutores.limpar()
    expect(locutores.identificar(eixo(0))).toBe('paciente')
    expect(locutores.identificar(eixo(1))).toBe('pessoa_2')
  })
})
