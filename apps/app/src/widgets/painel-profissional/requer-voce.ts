import type { ConsentimentosDoPaciente, Finalidade } from '../../entities/consentimento/api'
import { ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'
import type { SummaryResult } from '../../entities/patient/patient-summary'

export type FonteRequerVoce = 'risco' | 'assinatura' | 'consentimento'

export interface ItemRequerVoce {
  /** `${fonte}:${referencia}`. Chave de deduplicação — único ENTRE fontes por construção. */
  readonly id: string
  readonly fonte: FonteRequerVoce
  /** notaId | patientId | `${patientId}:${finalidade}` */
  readonly referencia: string
  readonly patientId: string
}

export function itensDeRisco(sumarios: readonly SummaryResult[]): ItemRequerVoce[] {
  return sumarios
    .filter((sumario) => sumario.ok && sumario.risk === 'elevado')
    .map((sumario) => ({ id: `risco:${sumario.patientId}`, fonte: 'risco', referencia: sumario.patientId, patientId: sumario.patientId }))
}

export function itensDeAssinatura(notas: readonly Nota[]): ItemRequerVoce[] {
  return notas
    .filter((nota) => nota.estado === ESTADO_PENDENTE)
    .map((nota) => ({ id: `assinatura:${nota.id}`, fonte: 'assinatura', referencia: nota.id, patientId: nota.patientId }))
}

const FINALIDADES: readonly Finalidade[] = ['gravacao', 'analiseIa']

export function itensDeConsentimento(
  porPaciente: readonly { patientId: string; consentimentos: ConsentimentosDoPaciente }[],
): ItemRequerVoce[] {
  return porPaciente.flatMap(({ patientId, consentimentos }) =>
    FINALIDADES.filter((finalidade) => consentimentos[finalidade] === 'pendente').map((finalidade) => ({
      id: `consentimento:${patientId}:${finalidade}`,
      fonte: 'consentimento' as const,
      referencia: `${patientId}:${finalidade}`,
      patientId,
    })),
  )
}

/** Map por id, primeiro a entrar ganha. Ordem: risco, assinatura, consentimento. */
export function juntarRequerVoce(listas: readonly (readonly ItemRequerVoce[])[]): readonly ItemRequerVoce[] {
  const porId = new Map<string, ItemRequerVoce>()
  for (const lista of listas) {
    for (const item of lista) {
      if (!porId.has(item.id)) {
        porId.set(item.id, item)
      }
    }
  }
  return [...porId.values()]
}
