import { describe, expect, it } from 'vitest'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, type ItemFila } from '../nota-fila/FilaAssinatura'
import { agruparPorPaciente } from './biblioteca'

describe('agruparPorPaciente', () => {
  it('agrupa por patientId e poe o rascunho no topo do seu grupo', () => {
    const itens: ItemFila[] = [
      { id: '1', patientId: 'p1', estado: ESTADO_ASSINADA },
      { id: '2', patientId: 'p1', estado: ESTADO_PENDENTE },
      { id: '3', patientId: 'p2', estado: ESTADO_ASSINADA },
    ]

    const grupos = agruparPorPaciente(itens)

    expect(grupos).toEqual([
      {
        patientId: 'p1',
        itens: [
          { id: '2', patientId: 'p1', estado: ESTADO_PENDENTE },
          { id: '1', patientId: 'p1', estado: ESTADO_ASSINADA },
        ],
      },
      {
        patientId: 'p2',
        itens: [{ id: '3', patientId: 'p2', estado: ESTADO_ASSINADA }],
      },
    ])
  })

  it('devolve lista vazia para itens vazios', () => {
    expect(agruparPorPaciente([])).toEqual([])
  })
})
