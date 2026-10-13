import { describe, expect, it } from 'vitest'
import { codificarWav } from './wav'

describe('codificarWav', () => {
  it('gera RIFF mono PCM16 little-endian com duração e amplitude corretas', () => {
    const bytes = codificarWav(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]))
    const view = new DataView(bytes.buffer)
    const texto = (offset: number) => new TextDecoder().decode(bytes.slice(offset, offset + 4))
    expect([texto(0), texto(8), texto(12), texto(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect(view.getUint32(4, true)).toBe(bytes.length - 8)
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(14)
    expect(Array.from({ length: 7 }, (_, i) => view.getInt16(44 + i * 2, true)))
      .toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767])
  })

  it('aceita áudio vazio e a taxa explícita do chamador', () => {
    const bytes = codificarWav(new Float32Array(), 48000)
    expect(bytes.length).toBe(44)
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(48000)
  })

  it.each([NaN, 16000.5, 7999, 96001])('rejeita taxa inválida %j', (rate) => {
    expect(() => codificarWav(new Float32Array(), rate)).toThrow('Taxa de áudio inválida.')
  })

  it.each([NaN, Infinity, -Infinity])('rejeita PCM não finito %j', (sample) => {
    expect(() => codificarWav(new Float32Array([sample]))).toThrow('Amostra de áudio inválida.')
  })

  it('rejeita tamanho que não cabe no cabeçalho RIFF antes de alocar', () => {
    expect(() => codificarWav({ length: 2 ** 31 } as Float32Array)).toThrow('Áudio excede o limite RIFF/WAVE.')
  })
})
