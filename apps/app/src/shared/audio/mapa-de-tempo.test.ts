import { describe, expect, it } from 'vitest'
import { MapaDeTempo } from './mapa-de-tempo'

const MS = 16
describe('mapa de tempo do áudio enviado', () => {
  it('sem silêncio descartado o tempo do servidor é o da captura', () => {
    const mapa = new MapaDeTempo()
    mapa.registrar(0, 1_000 * MS)
    mapa.registrar(1_000 * MS, 1_000 * MS)
    expect(mapa.enviadoMs).toBe(2_000)
    expect(mapa.paraRealMs(1_500)).toBe(1_500)
    expect(mapa.paraRealMs(2_000, true)).toBe(2_000)
  })

  it('fala, silêncio, fala: a segunda fala volta ao relógio da sessão, com o silêncio fora da conta do servidor', () => {
    const mapa = new MapaDeTempo()
    mapa.registrar(0, 8_000 * MS)
    mapa.registrar(8_000 * MS, 800 * MS)
    mapa.registrar(38_000 * MS, 8_000 * MS)
    expect(mapa.enviadoMs).toBe(16_800)
    expect(mapa.paraRealMs(1_000)).toBe(1_000)
    expect(mapa.paraRealMs(8_700, true)).toBe(8_700)
    expect(mapa.paraRealMs(8_800)).toBe(38_000)
    expect(mapa.paraRealMs(9_800)).toBe(39_000)
    expect(mapa.paraRealMs(16_800, true)).toBe(46_000)
  })

  it('o fim que cai exatamente onde outro trecho começa fica no trecho anterior, o começo vai para o seguinte', () => {
    const mapa = new MapaDeTempo()
    mapa.registrar(0, 1_000 * MS)
    mapa.registrar(5_000 * MS, 1_000 * MS)
    expect(mapa.paraRealMs(1_000, true)).toBe(1_000)
    expect(mapa.paraRealMs(1_000)).toBe(5_000)
    expect(mapa.paraRealMs(1_000.0000001)).toBe(5_000)
  })

  it('acha o trecho certo entre vários', () => {
    const mapa = new MapaDeTempo()
    for (let i = 0; i < 20; i++) mapa.registrar(i * 10_000 * MS, 1_000 * MS)
    for (let i = 0; i < 20; i++) expect(mapa.paraRealMs(i * 1_000 + 250)).toBe(i * 10_000 + 250)
  })

  it('antes de qualquer envio não há o que converter e vale o próprio tempo', () => {
    const mapa = new MapaDeTempo()
    expect(mapa.enviadoMs).toBe(0)
    expect(mapa.paraRealMs(1_234)).toBe(1_234)
  })
})
