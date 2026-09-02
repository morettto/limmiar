import { describe, expect, it } from 'vitest'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'
import { agruparPorPaciente } from './biblioteca'

function nota(id: string, patientId: string, estado: Nota['estado']): Nota {
  return { id, patientId, revisao: 0, frases: [], estado }
}

describe('agruparPorPaciente', () => {
  it('agrupa por patientId e poe o rascunho no topo do seu grupo', () => {
    const itens: Nota[] = [
      nota('1', 'p1', ESTADO_ASSINADA),
      nota('2', 'p1', ESTADO_PENDENTE),
      nota('3', 'p2', ESTADO_ASSINADA),
    ]

    const grupos = agruparPorPaciente(itens)

    expect(grupos).toEqual([
      {
        patientId: 'p1',
        itens: [nota('2', 'p1', ESTADO_PENDENTE), nota('1', 'p1', ESTADO_ASSINADA)],
      },
      {
        patientId: 'p2',
        itens: [nota('3', 'p2', ESTADO_ASSINADA)],
      },
    ])
  })

  it('devolve lista vazia para itens vazios', () => {
    expect(agruparPorPaciente([])).toEqual([])
  })
})
