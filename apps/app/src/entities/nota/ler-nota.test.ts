import { describe, it, expect } from 'vitest'
import { lerNota } from './ler-nota'
import { notaParaEntrada } from './nota-crypto'
import { ESTADO_PENDENTE, type Nota } from './nota'

const nota: Nota = { id: 'nota-1', patientId: 'paciente-1', atendimentoId: 'atendimento-1', revisao: 3, estado: ESTADO_PENDENTE,
  frases: [{ id: 'S-0', secao: 'S', texto: 'Relato do paciente.', ancoras: [{ inicioMs: 0, fimMs: 1500 }] }] }
const bytes = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor))
describe('lerNota', () => {
  it('não aceita referência malformada dentro de uma nota cifrada', () => {
    for (const referencias of [null, {}, [null], [{ titulo: 'Sem proveniência' }]]) {
      expect(lerNota(bytes({ tipo: 'nota', noteId: 'nota', atendimentoId: 'a', revisao: 0, frases: [{ secao: 'A', texto: 'Avaliação', ancoras: [], referencias }] }), 'p')).toBeNull()
    }
    expect(lerNota(bytes({ tipo: 'nota', noteId: 'nota', atendimentoId: 'a', revisao: 0, frases: [{ secao: 'A', texto: '', ancoras: [], referencias: [] }] }), 'p')?.frases[0]?.referencias).toEqual([])
  })
  it('reabre o conteúdo canônico sem transformar identidade, revisão, texto ou âncoras', () => {
    expect(lerNota(notaParaEntrada(nota), nota.patientId)).toEqual(nota)
  })
  it('recusa dados adulterados em cada fronteira clínica', () => {
    expect(lerNota(new TextEncoder().encode('{'), 'p')).toBeNull()
    for (const valor of [null, 4, {}, { tipo: 'nota', noteId: '', atendimentoId: 'a', revisao: 0, frases: [] },
      { tipo: 'nota', noteId: 'n', atendimentoId: 'a', revisao: -1, frases: [] }, { tipo: 'nota', noteId: 'n', atendimentoId: 'a', revisao: 0, frases: null },
      { tipo: 'nota', noteId: 'n', revisao: 0, frases: [] }, { tipo: 'nota', noteId: 'n', atendimentoId: '', revisao: 0, frases: [] },
      { tipo: 'nota', noteId: 'n', atendimentoId: 7, revisao: 0, frases: [] }]) expect(lerNota(bytes(valor), 'p')).toBeNull()
    for (const frase of [null, 4, { secao: 'X', texto: '', ancoras: [] }, { secao: 'S', texto: 2, ancoras: [] },
      { secao: 'S', texto: '', ancoras: null }, { secao: 'S', texto: '', ancoras: [null] },
      { secao: 'S', texto: '', ancoras: [{ inicioMs: -1, fimMs: 3 }] }, { secao: 'S', texto: '', ancoras: [{ inicioMs: 4, fimMs: 3 }] }]) {
      expect(lerNota(bytes({ tipo: 'nota', noteId: 'n', atendimentoId: 'a', revisao: 0, frases: [frase] }), 'p')).toBeNull()
    }
  })
  const base = { tipo: 'nota', noteId: 'n', atendimentoId: 'a', revisao: 0, frases: [] }
  it.each([
    ['tipo de outra coisa', { ...base, tipo: 'transcricao' }],
    ['sem tipo', { ...base, tipo: undefined }],
    ['identificador que não é texto', { ...base, noteId: 5 }],
    ['revisão em texto', { ...base, revisao: '3' }],
    ['revisão fracionária', { ...base, revisao: 1.5 }],
    ['revisão além do inteiro seguro', { ...base, revisao: 2 ** 60 }],
    ['revisão sem valor', { ...base, revisao: undefined }],
  ])('recusa nota com %s', (_caso, valor) => {
    expect(lerNota(bytes(valor), 'p')).toBeNull()
  })

  it.each([
    ['início em texto', { inicioMs: '1', fimMs: 3 }],
    ['fim em texto', { inicioMs: 1, fimMs: '3' }],
    ['início ausente', { fimMs: 3 }],
    ['fim ausente', { inicioMs: 1 }],
    ['fim nulo', { inicioMs: 1, fimMs: null }],
  ])('recusa âncora com %s', (_caso, ancora) => {
    expect(lerNota(bytes({ ...base, frases: [{ secao: 'S', texto: '', ancoras: [ancora] }] }), 'p')).toBeNull()
  })

  it('aceita uma âncora de um instante só e o início em zero', () => {
    const lida = lerNota(bytes({ ...base, frases: [{ secao: 'S', texto: 't', ancoras: [{ inicioMs: 0, fimMs: 0 }, { inicioMs: 5, fimMs: 5 }] }] }), 'p')
    expect(lida?.frases[0]?.ancoras).toEqual([{ inicioMs: 0, fimMs: 0 }, { inicioMs: 5, fimMs: 5 }])
  })

  it('texto que não é JSON ou JSON vazio nunca vira nota', () => {
    for (const texto of ['', 'null', '0', '""', 'false', 'texto solto']) expect(lerNota(new TextEncoder().encode(texto), 'p')).toBeNull()
  })
})
