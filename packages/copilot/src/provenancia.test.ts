import { describe, expect, it } from 'vitest'
import { deveAvisarVencimento, deveDescartarPorVencimento, separarPorAncora } from './provenancia.ts'
import type { Afirmacao } from './types.ts'

const ancorada = (texto: string): Afirmacao => ({ texto, ancoras: [{ inicioMs: 0, fimMs: 100 }] })
const semAncora = (texto: string): Afirmacao => ({ texto, ancoras: [] })
const multiAncora = (texto: string): Afirmacao => ({
  texto,
  ancoras: [
    { inicioMs: 0, fimMs: 100 },
    { inicioMs: 200, fimMs: 300 },
  ],
})

describe('separarPorAncora', () => {
  it('mantém só afirmações com ancoras.length > 0', () => {
    const resultado = separarPorAncora([ancorada('a'), semAncora('b'), ancorada('c')])
    expect(resultado.comAncora).toEqual([ancorada('a'), ancorada('c')])
    expect(resultado.descartadas).toBe(1)
  })

  it('mantém afirmação com múltiplas âncoras', () => {
    const resultado = separarPorAncora([multiAncora('a')])
    expect(resultado.comAncora).toEqual([multiAncora('a')])
    expect(resultado.descartadas).toBe(0)
  })

  it('lista vazia → nenhuma mantida, nenhuma descartada', () => {
    const resultado = separarPorAncora([])
    expect(resultado.comAncora).toEqual([])
    expect(resultado.descartadas).toBe(0)
  })

  it('todas sem âncora → nenhuma mantida, todas descartadas', () => {
    const resultado = separarPorAncora([semAncora('a'), semAncora('b')])
    expect(resultado.comAncora).toEqual([])
    expect(resultado.descartadas).toBe(2)
  })
})

const DIA_MS = 24 * 60 * 60 * 1000
const CRIADA_EM = '2026-01-01T00:00:00.000Z'
const agoraApos = (ms: number): string => new Date(Date.parse(CRIADA_EM) + ms).toISOString()

describe('deveAvisarVencimento', () => {
  it('false pouco antes dos 23 dias (22.999... dias)', () => {
    expect(deveAvisarVencimento(CRIADA_EM, agoraApos(23 * DIA_MS - 1))).toBe(false)
  })

  it('true exatamente aos 23 dias', () => {
    expect(deveAvisarVencimento(CRIADA_EM, agoraApos(23 * DIA_MS))).toBe(true)
  })

  it('true pouco antes dos 30 dias (29.999... dias)', () => {
    expect(deveAvisarVencimento(CRIADA_EM, agoraApos(30 * DIA_MS - 1))).toBe(true)
  })

  it('false exatamente aos 30 dias (já devia estar descartada)', () => {
    expect(deveAvisarVencimento(CRIADA_EM, agoraApos(30 * DIA_MS))).toBe(false)
  })
})

describe('deveDescartarPorVencimento', () => {
  it('false pouco antes dos 30 dias (29.999... dias)', () => {
    expect(deveDescartarPorVencimento(CRIADA_EM, agoraApos(30 * DIA_MS - 1))).toBe(false)
  })

  it('true exatamente aos 30 dias', () => {
    expect(deveDescartarPorVencimento(CRIADA_EM, agoraApos(30 * DIA_MS))).toBe(true)
  })
})
