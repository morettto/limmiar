import { BibliotecaNotas } from '../widgets/biblioteca/BibliotecaNotas'
import { ESTADO_ASSINADA, ESTADO_PENDENTE } from '../entities/nota/nota'
import type { GrupoPaciente } from '../features/nota-biblioteca/biblioteca'
import { CtRouter } from './ct-router'

// Anotado: sem tipo contextual, o literal alarga para `string`. O CT só serializa props simples
// (um Map não atravessa o mount) e o Link precisa de um roteador: por isso a montagem vive aqui.
const GRUPOS: readonly GrupoPaciente[] = [
  {
    patientId: 'paciente-1',
    itens: [
      { id: 'nota-1', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_PENDENTE, revisao: 0, frases: [] },
      { id: 'nota-2', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_ASSINADA, revisao: 0, frases: [] },
    ],
  },
]

export function CtBibliotecaNotas() {
  return (
    <CtRouter destinos={['/pacientes/$patientId/sessoes/$atendimentoId']}>
      <BibliotecaNotas grupos={GRUPOS} nomesPacientes={new Map([['paciente-1', 'Paciente sintético']])} termo="" onTermoChange={() => {}} resultado={{ estado: 'ocioso' }} />
    </CtRouter>
  )
}
