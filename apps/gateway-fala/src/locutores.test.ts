import { describe, expect, it } from 'vitest'
import { Locutores } from './locutores.ts'

const eixo = (i: number, outro = -1, peso = 0) => Array.from({ length: 6 }, (_, k) => (k === i ? 1 : k === outro ? peso : 0))
const pronta = () => {
  const locutores = new Locutores(eixo(0))
  expect(locutores.identificar(eixo(0))).toBe('profissional')
  return locutores
}

describe('Locutores', () => {
  it('reconhece perfil sem exigir normalização nem confirmação', () => {
    const locutores = new Locutores(eixo(0).map(valor => valor * 7))
    expect(locutores.identificar(eixo(0).map(valor => valor * 0.3))).toBe('profissional')
    expect(locutores.reconhecer(Float32Array.from(eixo(0, 1, 0.5)))).toBe('profissional')
  })

  it('exige profissional reconhecido e duas amostras para cadastrar paciente', () => {
    const locutores = new Locutores(eixo(0))
    expect(locutores.identificar(eixo(1), eixo(1))).toBeNull()
    expect(locutores.identificar(eixo(0))).toBe('profissional')
    expect(locutores.identificar(eixo(1))).toBeNull()
    expect(locutores.identificar(eixo(1), eixo(1, 2, 0.2))).toBe('paciente')
    expect(locutores.reconhecer(eixo(1))).toBe('paciente')
  })

  it('confirma participantes adicionais sem limitar a duas pessoas', () => {
    const locutores = pronta()
    expect(locutores.identificar(eixo(1), eixo(1))).toBe('paciente')
    expect(locutores.identificar(eixo(2), eixo(2))).toBe('pessoa_2')
    expect(locutores.identificar(eixo(3), eixo(3))).toBe('pessoa_3')
    expect(locutores.reconhecer(eixo(2, 1, 0.3))).toBe('pessoa_2')
    expect(locutores.identificar(eixo(3))).toBe('pessoa_3')
  })

  it('paciente vence similaridade fraca com profissional, empate fica incerto', () => {
    const locutores = pronta()
    locutores.identificar(eixo(1), eixo(1))
    expect(locutores.reconhecer(eixo(1, 0, 0.65))).toBe('paciente')
    expect(locutores.reconhecer(eixo(1, 0, 1))).toBeNull()
    expect(locutores.identificar(eixo(1, 0, 1), eixo(1, 0, 1))).toBeNull()
  })

  it('amostras inconsistentes, fracas ou próximas de voz conhecida não criam pessoa', () => {
    const locutores = pronta()
    expect(locutores.identificar(eixo(1), eixo(2))).toBeNull()
    expect(locutores.identificar(eixo(1), eixo(0))).toBeNull()
    expect(locutores.identificar(eixo(1, 0, 0.5), eixo(1, 0, 0.5))).toBeNull()
    expect(locutores.identificar(eixo(1), eixo(1, 0, 0.5))).toBeNull()
    expect(locutores.identificar(eixo(1))).toBeNull()
    expect(locutores.reconhecer(new Float32Array(6))).toBeNull()
  })

  it('ancora confirmada da sessão reconhece prosódia posterior sem alterar perfil original', () => {
    const locutores = pronta()
    const variante = eixo(0, 2, 1.4)
    expect(locutores.identificar(variante, variante)).toBe('profissional')
    expect(locutores.reconhecer(eixo(2))).toBe('profissional')
    expect(locutores.reconhecer(eixo(0))).toBe('profissional')
    locutores.identificar(eixo(0), eixo(0))
    expect(locutores.reconhecer(eixo(2))).toBeNull()
    expect(locutores.reconhecer(eixo(0))).toBe('profissional')
  })

  it('não aprende par contaminado nem clip sem confirmação', () => {
    const locutores = pronta()
    const variante = eixo(0, 2, 1.4)
    expect(locutores.identificar(variante, eixo(1))).toBe('profissional')
    expect(locutores.reconhecer(eixo(2))).toBeNull()
    locutores.identificar(variante)
    expect(locutores.reconhecer(eixo(2))).toBeNull()
    expect(locutores.identificar(variante, eixo(0, 2, -1.4))).toBe('profissional')
    expect(locutores.reconhecer(eixo(2))).toBeNull()
  })

  it('apaga todos os protótipos e estado ao limpar', () => {
    const locutores = pronta()
    locutores.identificar(eixo(0, 2, 1.4), eixo(0, 2, 1.4))
    locutores.identificar(eixo(1), eixo(1))
    locutores.limpar()
    expect(locutores.reconhecer(eixo(0))).toBeNull()
    expect(locutores.identificar(eixo(1), eixo(1))).toBeNull()
  })
})
