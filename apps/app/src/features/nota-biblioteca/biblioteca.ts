import { ESTADO_PENDENTE, type ItemFila } from '../nota-fila/FilaAssinatura'

export interface GrupoPaciente {
  readonly patientId: string
  readonly itens: readonly ItemFila[]
}

// Ordem determinística: os grupos saem pela ordem da primeira ocorrência de cada patientId, e
// dentro do grupo os rascunhos vêm primeiro, com a ordem de entrada preservada (`filter` é estável).
// Sem isto a lista saltaria entre renders, contra o critério 3.
export function agruparPorPaciente(itens: readonly ItemFila[]): GrupoPaciente[] {
  const porPaciente = new Map<string, ItemFila[]>()
  for (const item of itens) {
    const grupo = porPaciente.get(item.patientId)
    if (grupo) {
      grupo.push(item)
    } else {
      porPaciente.set(item.patientId, [item])
    }
  }
  return [...porPaciente.entries()].map(([patientId, itensDoGrupo]) => ({
    patientId,
    itens: [
      ...itensDoGrupo.filter((item) => item.estado === ESTADO_PENDENTE),
      ...itensDoGrupo.filter((item) => item.estado !== ESTADO_PENDENTE),
    ],
  }))
}
