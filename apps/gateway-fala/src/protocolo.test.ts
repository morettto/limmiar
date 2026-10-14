import { describe, expect, it } from 'vitest'
import { ehConcluir, ErroDeProtocolo, lerInicio } from './protocolo.ts'

const perfil = [0.1, 0.2, 0.3]
const inicio = (extra: Record<string, unknown>) => JSON.stringify({ type: 'iniciar', sample_rate: 16000, idioma: 'pt', ...extra })

describe('lerInicio', () => {
  it('aceita a sessão presencial com a impressão de voz', () => {
    expect(lerInicio(inicio({ modo: 'presencial', perfil }), 3)).toEqual({ modo: 'presencial', idioma: 'pt', perfil })
  })

  it('aceita a sessão online com o falante da trilha', () => {
    expect(lerInicio(inicio({ modo: 'online', falante: 'paciente' }), 3)).toEqual({ modo: 'online', idioma: 'pt', falante: 'paciente' })
    expect(lerInicio(inicio({ modo: 'online', falante: 'profissional', idioma: 'pt-BR' }), 3)).toEqual({ modo: 'online', idioma: 'pt-BR', falante: 'profissional' })
  })

  it.each([
    ['texto que não é JSON', 'isto não é json'],
    ['JSON que não é objeto', '5'],
    ['JSON nulo', 'null'],
    ['tipo errado', JSON.stringify({ type: 'outra', sample_rate: 16000 })],
    ['taxa diferente de 16 kHz', inicio({ sample_rate: 48000, modo: 'presencial', perfil })],
    ['idioma ausente', inicio({ idioma: undefined, modo: 'presencial', perfil })],
    ['idioma malformado', inicio({ idioma: 'português do brasil', modo: 'presencial', perfil })],
    ['modo desconhecido', inicio({ modo: 'outro', perfil })],
    ['online sem falante', inicio({ modo: 'online' })],
    ['online com falante desconhecido', inicio({ modo: 'online', falante: 'pessoa_2' })],
    ['presencial sem perfil', inicio({ modo: 'presencial' })],
    ['perfil que não é lista', inicio({ modo: 'presencial', perfil: 'abc' })],
    ['perfil com dimensão errada', inicio({ modo: 'presencial', perfil: [0.1, 0.2] })],
    ['perfil com texto', inicio({ modo: 'presencial', perfil: [0.1, 0.2, 'x'] })],
    ['perfil com valor não finito', '{"type":"iniciar","sample_rate":16000,"idioma":"pt","modo":"presencial","perfil":[0.1,0.2,1e999]}'],
    ['perfil zerado', inicio({ modo: 'presencial', perfil: [0, 0, 0] })],
  ])('recusa %s', (_, texto) => {
    expect(() => lerInicio(texto, 3)).toThrow(ErroDeProtocolo)
  })

  it('não repete a impressão de voz na mensagem de erro', () => {
    expect(() => lerInicio(inicio({ modo: 'presencial', perfil: [0.123456, 0.2] }), 3)).toThrow(/^Perfil de voz inválido\.$/)
  })
})

describe('ehConcluir', () => {
  it('reconhece só o comando concluir', () => {
    expect(ehConcluir('{"type":"concluir"}')).toBe(true)
    expect(ehConcluir('{"type":"outro"}')).toBe(false)
    expect(ehConcluir('null')).toBe(false)
    expect(ehConcluir('lixo')).toBe(false)
  })
})
