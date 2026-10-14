import { describe, expect, it } from 'vitest'
import { PortaDeVoz } from './porta-de-voz'

const QUADRO = 1280
const silencio = () => new Float32Array(QUADRO)
const fala = () => Float32Array.from({ length: QUADRO }, (_, i) => i % 2 === 0 ? 0.2 : -0.2)
// Ruído constante de rms 0,02.
const ruido = () => Float32Array.from({ length: QUADRO }, (_, i) => i % 2 === 0 ? 0.02 : -0.02)
const rodar = (porta: PortaDeVoz, quadros: (() => Float32Array)[]) => quadros.flatMap((quadro) => porta.passar(quadro()).map((q) => q.inicio / QUADRO))
const repetir = (quantidade: number, quadro: () => Float32Array) => Array.from({ length: quantidade }, () => quadro)

describe('porta de voz', () => {
  it('não deixa passar silêncio', () => {
    expect(rodar(new PortaDeVoz(), repetir(100, silencio))).toEqual([])
  })

  it('deixa passar a fala com 300 ms de pré-rolagem e 800 ms de cauda, e para de novo', () => {
    const passou = rodar(new PortaDeVoz(), [...repetir(20, silencio), ...repetir(10, fala), ...repetir(30, silencio)])
    expect(passou).toEqual([16, 17, 18, 19, ...Array.from({ length: 10 }, (_, i) => 20 + i), ...Array.from({ length: 10 }, (_, i) => 30 + i)])
  })

  it('a pausa curta no meio da fala não corta a frase', () => {
    const passou = rodar(new PortaDeVoz(), [...repetir(5, fala), ...repetir(9, silencio), ...repetir(5, fala), ...repetir(30, silencio)])
    expect(passou.slice(0, 19)).toEqual(Array.from({ length: 19 }, (_, i) => i))
    expect(passou).toHaveLength(19 + 10)
  })

  it('o ruído de fundo constante deixa de ser tratado como voz depois que o piso o aprende, e a fala por cima dele passa', () => {
    const porta = new PortaDeVoz()
    const inicio = rodar(porta, repetir(80, ruido))
    expect(Math.max(...inicio)).toBeLessThan(60)
    expect(rodar(porta, repetir(100, ruido))).toEqual([])
    const comFala = rodar(porta, [...repetir(5, fala), ...repetir(30, ruido)])
    expect(comFala.length).toBeGreaterThanOrEqual(5 + 10)
  })

  it('o piso sobe com o ruído e desce quando o ambiente fica mais quieto', () => {
    const porta = new PortaDeVoz()
    rodar(porta, repetir(80, ruido))
    expect(rodar(porta, repetir(5, fala)).length).toBe(4 + 5)
    rodar(porta, repetir(60, silencio))
    expect(rodar(porta, repetir(2, ruido)).length).toBeGreaterThan(0)
  })

  it('os quadros devolvidos trazem o áudio e a posição de início em amostras', () => {
    const porta = new PortaDeVoz()
    const parte = Float32Array.of(0.3, -0.3, 0.3)
    expect(porta.passar(parte)).toEqual([{ pcm: parte, inicio: 0 }])
    expect(porta.passar(parte)[0]!.inicio).toBe(3)
  })

  it('um bloco maior que a pré-rolagem ainda é guardado inteiro', () => {
    const porta = new PortaDeVoz()
    expect(porta.passar(new Float32Array(16_000))).toEqual([])
    expect(porta.passar(Float32Array.from({ length: 16_000 }, () => 0.2)).map((q) => q.inicio)).toEqual([0, 16_000])
  })
})
