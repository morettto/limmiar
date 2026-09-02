import { ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'

export interface GrupoPaciente {
  readonly patientId: string
  readonly itens: readonly Nota[]
}

// Ordem determinística: os grupos saem pela ordem da primeira ocorrência de cada
// patientId em `itens` (Map preserva ordem de inserção); dentro do grupo, os rascunhos
// (ESTADO_PENDENTE) vêm primeiro e a ordem relativa dentro de cada partição (rascunhos
// entre si, assinadas entre si) é a de entrada -- `Array.prototype.filter` é estável, então
// não precisa de comparador de sort próprio. Sem isto uma lista que salta entre renders
// seria bug (critério de aceite 3: "rascunhos em destaque no topo").
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
