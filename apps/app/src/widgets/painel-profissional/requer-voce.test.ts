import { describe, expect, it } from 'vitest'
import type { SummaryResult } from '../../entities/patient/patient-summary'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, ORDEM_SECOES, type Nota } from '../../entities/nota/nota'
import type { ConsentimentosDoPaciente } from '../../entities/consentimento/api'
import {
  itensDeAssinatura,
  itensDeConsentimento,
  itensDeRisco,
  juntarRequerVoce,
  type ItemRequerVoce,
} from './requer-voce'

function nota(overrides: Partial<Nota> = {}): Nota {
  return {
    id: 'nota-1',
    patientId: 'p-1',
    revisao: 0,
    frases: ORDEM_SECOES.map((secao) => ({ id: `${secao}-0`, secao, texto: '', ancoras: [] })),
    estado: ESTADO_PENDENTE,
    ...overrides,
  }
}

describe('itensDeRisco', () => {
  it('gera um item por paciente com risco elevado', () => {
    const sumarios: SummaryResult[] = [
      { patientId: 'p-1', ok: true, name: 'Ana', risk: 'elevado' },
      { patientId: 'p-2', ok: true, name: 'Bruno', risk: 'moderado' },
    ]
    expect(itensDeRisco(sumarios)).toEqual([{ id: 'risco:p-1', fonte: 'risco', referencia: 'p-1', patientId: 'p-1' }])
  })

  it('ignora sumários não decifrados (ok:false)', () => {
    const sumarios: SummaryResult[] = [{ patientId: 'p-1', ok: false }]
    expect(itensDeRisco(sumarios)).toEqual([])
  })
})

describe('itensDeAssinatura', () => {
  it('gera um item por nota pendente de assinatura', () => {
    const notas: Nota[] = [nota({ id: 'n-1' }), nota({ id: 'n-2', estado: ESTADO_ASSINADA })]
    expect(itensDeAssinatura(notas)).toEqual([
      { id: 'assinatura:n-1', fonte: 'assinatura', referencia: 'n-1', patientId: 'p-1' },
    ])
  })
})

describe('itensDeConsentimento', () => {
  it('gera uma entrada por finalidade pendente', () => {
    const porPaciente: { patientId: string; consentimentos: ConsentimentosDoPaciente }[] = [
      { patientId: 'p-1', consentimentos: { gravacao: 'pendente', analiseIa: 'concedido' } },
    ]
    expect(itensDeConsentimento(porPaciente)).toEqual([
      { id: 'consentimento:p-1:gravacao', fonte: 'consentimento', referencia: 'p-1:gravacao', patientId: 'p-1' },
    ])
  })

  it('sem finalidade pendente não gera item', () => {
    const porPaciente: { patientId: string; consentimentos: ConsentimentosDoPaciente }[] = [
      { patientId: 'p-1', consentimentos: { gravacao: 'concedido', analiseIa: 'revogado' } },
    ]
    expect(itensDeConsentimento(porPaciente)).toEqual([])
  })
})

describe('juntarRequerVoce', () => {
  it('o mesmo paciente em risco e consentimento gera dois itens — não perde nenhum', () => {
    const listas: (readonly ItemRequerVoce[])[] = [
      [{ id: 'risco:p-1', fonte: 'risco', referencia: 'p-1', patientId: 'p-1' }],
      [],
      [{ id: 'consentimento:p-1:gravacao', fonte: 'consentimento', referencia: 'p-1:gravacao', patientId: 'p-1' }],
    ]
    expect(juntarRequerVoce(listas)).toEqual([
      { id: 'risco:p-1', fonte: 'risco', referencia: 'p-1', patientId: 'p-1' },
      { id: 'consentimento:p-1:gravacao', fonte: 'consentimento', referencia: 'p-1:gravacao', patientId: 'p-1' },
    ])
  })

  it('o mesmo item entregue duas vezes colapsa — não duplica', () => {
    const item: ItemRequerVoce = { id: 'risco:p-1', fonte: 'risco', referencia: 'p-1', patientId: 'p-1' }
    const listas: (readonly ItemRequerVoce[])[] = [[item], [item]]
    expect(juntarRequerVoce(listas)).toEqual([item])
  })
})
