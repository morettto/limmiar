import { describe, expect, it } from 'vitest'
import { BufferPcm } from './buffer-pcm.ts'

const rampa = (de: number, ate: number) => Int16Array.from({ length: ate - de }, (_, i) => de + i)
const inteiros = (pcm: Float32Array) => [...pcm].map((valor) => Math.round(valor * 32768))

describe('BufferPcm', () => {
  it('recorta o que foi escrito, em float', () => {
    const buffer = new BufferPcm(100)
    buffer.escrever(rampa(0, 50))
    expect(buffer.recebidas).toBe(50)
    expect(inteiros(buffer.recortar(10, 13))).toEqual([10, 11, 12])
  })

  it('devolve vazio para o que ainda não chegou ou já saiu', () => {
    const buffer = new BufferPcm(100)
    buffer.escrever(rampa(0, 50))
    expect(buffer.recortar(60, 70)).toHaveLength(0)
    expect(buffer.recortar(40, 20)).toHaveLength(0)
    expect(buffer.recortar(-10, 5)).toHaveLength(5)
    buffer.escrever(rampa(50, 250))
    expect(buffer.recortar(0, 100)).toHaveLength(0)
  })

  it('dá a volta no anel sem perder a ordem', () => {
    const buffer = new BufferPcm(100)
    buffer.escrever(rampa(0, 80))
    buffer.escrever(rampa(80, 130))
    expect(buffer.recebidas).toBe(130)
    expect(inteiros(buffer.recortar(28, 34))).toEqual([30, 31, 32, 33])
    expect(inteiros(buffer.recortar(98, 102))).toEqual([98, 99, 100, 101])
  })

  it('guarda só o fim de uma escrita maior que o anel', () => {
    const buffer = new BufferPcm(100)
    buffer.escrever(rampa(0, 30))
    buffer.escrever(rampa(30, 250).map((valor) => valor))
    expect(buffer.recebidas).toBe(250)
    expect(inteiros(buffer.recortar(148, 152))).toEqual([150, 151])
    expect(inteiros(buffer.recortar(246, 252))).toEqual([246, 247, 248, 249])
  })

  it('apaga tudo ao limpar', () => {
    const buffer = new BufferPcm(100)
    buffer.escrever(rampa(1, 51))
    buffer.limpar()
    expect(buffer.recebidas).toBe(0)
    buffer.escrever(new Int16Array(10))
    expect(inteiros(buffer.recortar(0, 10)).every((valor) => valor === 0)).toBe(true)
    expect(buffer.recortar(10, 50)).toHaveLength(0)
  })

  it('não deixa resto do que foi escrito antes de limpar', () => {
    const buffer = new BufferPcm(100)
    buffer.escrever(rampa(1, 101))
    buffer.limpar()
    buffer.escrever(new Int16Array(100))
    expect(inteiros(buffer.recortar(0, 100)).some((valor) => valor !== 0)).toBe(false)
  })
})
