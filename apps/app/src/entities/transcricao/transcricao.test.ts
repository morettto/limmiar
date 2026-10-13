import { describe, expect, it } from 'vitest'
import { lerTranscricao, transcricaoParaEntrada, type Transcricao } from './transcricao'

const transcricao: Transcricao = { id: 'sessao', patientId: 'paciente', revisao: 0, autorId: 'profissional', registradaEm: '2026-10-02T12:00:00Z',
  palavras: [{ texto: 'Tenho medo de sair', inicioMs: 12400, fimMs: 13900, locutor: 'voz-paciente' }], papeis: { 'voz-paciente': 'paciente' } }
const entrada = JSON.parse(new TextDecoder().decode(transcricaoParaEntrada(transcricao))) as Record<string, unknown>
const bytes = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor))

describe('transcrição persistida', () => {
  it('preserva palavras, tempos, autoria e revisão e descarta campos de áudio nas duas fronteiras', () => {
    const contaminada = { ...transcricao, audio: 'nunca salvar', palavras: transcricao.palavras.map((palavra) => ({ ...palavra, audio: 'nunca salvar' })) }
    expect(lerTranscricao(transcricaoParaEntrada(contaminada), 'paciente')).toEqual(transcricao)
    expect(new TextDecoder().decode(transcricaoParaEntrada(contaminada))).not.toContain('audio')
    const lida = lerTranscricao(bytes({ ...entrada, palavras: contaminada.palavras }), 'paciente')!
    expect(lida.palavras).toEqual(transcricao.palavras)
    expect(new TextDecoder().decode(transcricaoParaEntrada(lida))).not.toContain('audio')
  })
  it('ordena o mapa de papéis para reconhecer uma escrita após perder sua resposta', () => {
    const a = { ...transcricao, papeis: { z: 'voce' as const, a: 'paciente' as const } }
    const b = { ...a, papeis: { a: 'paciente' as const, z: 'voce' as const } }
    expect(transcricaoParaEntrada(a)).toEqual(transcricaoParaEntrada(b))
  })
  it('recusa JSON incompleto', () => { expect(lerTranscricao(new TextEncoder().encode('{'), 'paciente')).toBeNull() })
  it.each([null, 3, [], {}, { ...entrada, tipo: 'nota' }, { ...entrada, transcriptId: '' }, { ...entrada, transcriptId: 1 },
    { ...entrada, revisao: -1 }, { ...entrada, revisao: 0.5 }, { ...entrada, revisao: '0' }, { ...entrada, autorId: '' },
    { ...entrada, autorId: null }, { ...entrada, registradaEm: 'data inválida' }, { ...entrada, registradaEm: 1 },
    { ...entrada, papeis: null }, { ...entrada, papeis: [] }, { ...entrada, papeis: { 'voz-paciente': 'incerto' } },
    { ...entrada, palavras: [] }, { ...entrada, palavras: null },
  ])('recusa metadados inválidos: %j', (valor) => { expect(lerTranscricao(bytes(valor), 'paciente')).toBeNull() })
  it.each([null, 3, {}, { texto: ' ', inicioMs: 0, fimMs: 1, locutor: 'voz-paciente' },
    { texto: 3, inicioMs: 0, fimMs: 1, locutor: 'voz-paciente' }, { texto: 'fala', inicioMs: -1, fimMs: 1, locutor: 'voz-paciente' },
    { texto: 'fala', inicioMs: '0', fimMs: 1, locutor: 'voz-paciente' }, { texto: 'fala', inicioMs: 2, fimMs: 1, locutor: 'voz-paciente' },
    { texto: 'fala', inicioMs: 0, fimMs: '1', locutor: 'voz-paciente' }, { texto: 'fala', inicioMs: 0, fimMs: 1, locutor: null },
    { texto: 'fala', inicioMs: 0, fimMs: 1, locutor: 'voz-estranha' }, { texto: 'fala', inicioMs: 0, fimMs: 1, locutor: '__proto__' },
  ])('recusa palavra ou atribuição inválida: %j', (palavra) => { expect(lerTranscricao(bytes({ ...entrada, palavras: [palavra] }), 'paciente')).toBeNull() })
})
