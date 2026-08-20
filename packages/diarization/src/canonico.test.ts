import { describe, expect, it } from 'vitest'
import { montarTranscricaoCanonica } from './canonico'
import type { PalavraAtribuida } from './merge'
import type { RotuloLocutor } from './classify'

function palavra(texto: string, locutor: string | null): PalavraAtribuida {
  return { texto, inicioMs: 0, fimMs: 100, locutor }
}

describe('montarTranscricaoCanonica', () => {
  it('caso 1: sequência vazia devolve array vazio', () => {
    const resultado = montarTranscricaoCanonica([], new Map())

    expect(resultado).toEqual([])
  })

  it('caso 2: todas as palavras do mesmo locutor formam um único trecho', () => {
    const palavras = [palavra('oi', 'S0'), palavra('tudo', 'S0'), palavra('bem', 'S0')]
    const rotulos = new Map<string, RotuloLocutor | null>([['S0', 'voce']])

    const resultado = montarTranscricaoCanonica(palavras, rotulos)

    expect(resultado).toEqual([{ locutor: 'voce', palavras }])
  })

  it('caso 3: alternância a cada palavra gera um trecho por palavra', () => {
    const p1 = palavra('oi', 'S0')
    const p2 = palavra('oi', 'S1')
    const p3 = palavra('oi', 'S0')
    const rotulos = new Map<string, RotuloLocutor | null>([
      ['S0', 'voce'],
      ['S1', 'paciente'],
    ])

    const resultado = montarTranscricaoCanonica([p1, p2, p3], rotulos)

    expect(resultado).toEqual([
      { locutor: 'voce', palavras: [p1] },
      { locutor: 'paciente', palavras: [p2] },
      { locutor: 'voce', palavras: [p3] },
    ])
  })

  it('caso 4: locutor null no meio fecha o trecho anterior e não entra em nenhum trecho', () => {
    const p1 = palavra('oi', 'S0')
    const p2 = palavra('hum', null)
    const p3 = palavra('tudo', 'S0')
    const rotulos = new Map<string, RotuloLocutor | null>([['S0', 'voce']])

    const resultado = montarTranscricaoCanonica([p1, p2, p3], rotulos)

    expect(resultado).toEqual([
      { locutor: 'voce', palavras: [p1] },
      { locutor: 'voce', palavras: [p3] },
    ])
  })

  it('caso 5: locutor ausente do mapa é tratado como indeterminado (mesma convenção do null)', () => {
    const p1 = palavra('oi', 'S0')
    const p2 = palavra('?', 'S_desconhecido')
    const rotulos = new Map<string, RotuloLocutor | null>([['S0', 'voce']])

    const resultado = montarTranscricaoCanonica([p1, p2], rotulos)

    expect(resultado).toEqual([{ locutor: 'voce', palavras: [p1] }])
  })

  it('caso 6: rótulo classificado como null explicitamente (margem ambígua) também não entra em trecho', () => {
    const p1 = palavra('oi', 'S0')
    const rotulos = new Map<string, RotuloLocutor | null>([['S0', null]])

    const resultado = montarTranscricaoCanonica([p1], rotulos)

    expect(resultado).toEqual([])
  })
})
