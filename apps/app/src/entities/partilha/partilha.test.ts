import { describe, expect, it } from 'vitest'
import { comPartilha, type EstadoPartilha } from './partilha'

const CHAVE = '22222222-2222-2222-2222-222222222222|2026-09-14T10:00:00Z'

describe('comPartilha', () => {
  it('ativa=true liga o tipo para a chave dada, sem mexer noutras chaves', () => {
    const estadoInicial: EstadoPartilha = { 'outra-chave': { checkin: true } }

    const proximo = comPartilha(estadoInicial, CHAVE, 'checkin', true)

    expect(proximo[CHAVE]).toEqual({ checkin: true })
    expect(proximo['outra-chave']).toEqual({ checkin: true })
  })

  it('ativa=false desliga o tipo para a chave dada', () => {
    const estadoInicial: EstadoPartilha = { [CHAVE]: { checkin: true } }

    const proximo = comPartilha(estadoInicial, CHAVE, 'checkin', false)

    expect(proximo[CHAVE]?.checkin).toBeUndefined()
  })
})
