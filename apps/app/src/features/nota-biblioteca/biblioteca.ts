import { ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'

export interface GrupoPaciente {
  readonly patientId: string
  readonly itens: readonly Nota[]
}

// Ordem determinística: grupos pela primeira ocorrência do patientId (Map preserva inserção)
// e rascunhos primeiro dentro do grupo, com `filter` estável a manter a ordem de entrada.
// Uma lista que salta entre renders seria bug (critério de aceite 3).
export function agruparPorPaciente(itens: readonly Nota[]): GrupoPaciente[] {
  const porPaciente = new Map<string, Nota[]>()
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
