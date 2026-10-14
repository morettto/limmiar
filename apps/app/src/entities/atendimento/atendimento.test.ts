import { describe, expect, it } from 'vitest'
import { atendimentoParaEntrada, encerramentoParaEntrada, lerAtendimento, lerEncerramento, type Atendimento } from './atendimento'

const atendimento: Atendimento = { id: 'atendimento-1', patientId: 'paciente', agendamentoId: 'agendamento-1', iniciadoEm: '2026-10-01T12:00:00.000Z' }
const bytes = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor))
const valido = { tipo: 'atendimento', atendimentoId: 'a', agendamentoId: 'b', iniciadoEm: '2026-10-01T12:00:00Z' }

describe('atendimento', () => {
  it('serializa e reabre o encerramento sem dados do paciente', () => {
    const encerramento = { atendimentoId: 'sessao', encerradoEm: '2026-10-13T16:00:00.000Z', autorId: 'conta' }
    const entrada = encerramentoParaEntrada(encerramento)
    expect(JSON.parse(new TextDecoder().decode(entrada))).toEqual({ tipo: 'encerramento-atendimento', ...encerramento })
    expect(lerEncerramento(entrada)).toEqual(encerramento)
  })

  it('recusa encerramentos ilegíveis, de outro tipo e campos ausentes ou inválidos', () => {
    const encerramento = { tipo: 'encerramento-atendimento', atendimentoId: 'sessao', encerradoEm: '2026-10-13T16:00:00Z', autorId: 'conta' }
    expect(lerEncerramento(new TextEncoder().encode('{'))).toBeNull()
    for (const valor of [null, 4, [], {}, { ...encerramento, tipo: 'atendimento' },
      { ...encerramento, atendimentoId: undefined }, { ...encerramento, atendimentoId: ' ' }, { ...encerramento, atendimentoId: 7 },
      { ...encerramento, autorId: undefined }, { ...encerramento, autorId: '' }, { ...encerramento, autorId: false },
      { ...encerramento, encerradoEm: undefined }, { ...encerramento, encerradoEm: 5 }, { ...encerramento, encerradoEm: 'ontem' }]) {
      expect(lerEncerramento(bytes(valor))).toBeNull()
    }
  })
  it('reabre o atendimento cifrado no prontuário sem gravar o paciente na entrada', () => {
    const entrada = atendimentoParaEntrada(atendimento)
    expect(JSON.parse(new TextDecoder().decode(entrada))).toEqual({ tipo: 'atendimento', atendimentoId: 'atendimento-1',
      agendamentoId: 'agendamento-1', iniciadoEm: '2026-10-01T12:00:00.000Z' })
    expect(lerAtendimento(entrada, 'paciente')).toEqual(atendimento)
  })

  it('recusa entrada ilegível, de outro tipo ou com campo ausente, vazio ou malformado', () => {
    expect(lerAtendimento(new TextEncoder().encode('{'), 'p')).toBeNull()
    for (const invalida of [null, 4, {}, { ...valido, tipo: 'transcricao' }, { ...valido, atendimentoId: ' ' }, { ...valido, atendimentoId: 7 },
      { ...valido, agendamentoId: '' }, { ...valido, agendamentoId: undefined }, { ...valido, iniciadoEm: 'ontem' }, { ...valido, iniciadoEm: 5 }]) {
      expect(lerAtendimento(bytes(invalida), 'p')).toBeNull()
    }
    expect(lerAtendimento(bytes(valido), 'p')).toEqual({ id: 'a', patientId: 'p', agendamentoId: 'b', iniciadoEm: valido.iniciadoEm })
  })
})
