import { describe, expect, it } from 'vitest'
import { atendimentoParaEntrada, lerAtendimento, type Atendimento } from './atendimento'

const atendimento: Atendimento = { id: 'atendimento-1', patientId: 'paciente', agendamentoId: 'agendamento-1', iniciadoEm: '2026-10-01T12:00:00.000Z' }
const bytes = (valor: unknown) => new TextEncoder().encode(JSON.stringify(valor))
const valido = { tipo: 'atendimento', atendimentoId: 'a', agendamentoId: 'b', iniciadoEm: '2026-10-01T12:00:00Z' }

describe('atendimento', () => {
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
