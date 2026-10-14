import { t } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { CryptoKey } from '@limmiar/crypto'
import { lerAtendimento, lerEncerramento, type Atendimento } from '../../entities/atendimento/atendimento'
import { obterConsentimentos, type ConsentimentosDoPaciente } from '../../entities/consentimento/api'
import type { Nota } from '../../entities/nota/nota'
import { abrirNotas } from '../../entities/nota/abrir-notas'
import { getPatientRecord } from '../../entities/patient/api'
import { openRecord } from '../../entities/patient/patient-crypto'
import { parseSummaryPlaintext, type PatientRisk } from '../../entities/patient/patient-summary'
import { lerTranscricao, type Transcricao } from '../../entities/transcricao/transcricao'
import { translateProblemCode } from '../../shared/api'

export interface Prontuario {
  nome: string
  risco: PatientRisk
  dek: CryptoKey
  consentimentos: ConsentimentosDoPaciente
  transcricoes: Transcricao[]
  notas: Nota[]
  atendimentos: Atendimento[]
}

export async function abrirProntuario(baseUrl: string, accountId: string, accessToken: string,
  kek: CryptoKey, patientId: string): Promise<Prontuario> {
  const [registro, consentimentos] = await Promise.all([
    getPatientRecord(baseUrl, accountId, accessToken, patientId),
    obterConsentimentos(baseUrl, accountId, accessToken, patientId),
  ])
  if (!registro.ok) throw new Error(translateProblemCode(registro.code, registro.params, i18n))
  if (!consentimentos.ok) throw new Error(translateProblemCode(consentimentos.code, consentimentos.params, i18n))
  const aberto = await openRecord(kek, registro, patientId)
  const resumo = parseSummaryPlaintext(aberto.plaintexts[0]!)
  if (resumo === null) throw new Error(t`Não foi possível ler o paciente`)
  const entradas = aberto.plaintexts.slice(1)
  const transcricoes = entradas.flatMap((bytes) => {
    const transcricao = lerTranscricao(bytes, patientId)
    return transcricao === null ? [] : [transcricao]
  })
  const atendimentos = entradas.flatMap((bytes) => {
    const atendimento = lerAtendimento(bytes, patientId)
    return atendimento === null ? [] : [atendimento]
  })
  const encerramentos = new Map(entradas.flatMap(bytes => {
    const encerramento = lerEncerramento(bytes)
    return encerramento ? [[encerramento.atendimentoId, encerramento.encerradoEm] as const] : []
  }))
  const notas = await abrirNotas(entradas, patientId, aberto.dek, baseUrl, accountId, accessToken)
  return { nome: resumo.name, risco: resumo.risk, dek: aberto.dek, consentimentos: consentimentos.consentimentos, transcricoes, notas,
    atendimentos: atendimentos.map(atendimento => encerramentos.has(atendimento.id)
      ? { ...atendimento, encerradoEm: encerramentos.get(atendimento.id)! } : atendimento) }
}
