import { i18n } from '@lingui/core'
import type { CryptoKey } from '@limmiar/crypto'
import { agendarSessao } from '../../entities/agenda/api'
import { atendimentoParaEntrada, lerAtendimento, type Atendimento } from '../../entities/atendimento/atendimento'
import { appendPatientEntry, getPatientRecord } from '../../entities/patient/api'
import { openEntries, sealEntry } from '../../entities/patient/patient-crypto'
import { translateProblemCode } from '../../shared/api'

const DURACAO_PADRAO_MINUTOS = 50

export interface IniciarAtendimentoParams {
  baseUrl: string
  accountId: string
  accessToken: string
  dek: CryptoKey
  patientId: string
  /** Sem agendamento, a sessão ganha um agendamento criado agora. */
  agendamentoId?: string
}

/** Um agendamento tem no máximo um atendimento: abre o que já existe em vez de duplicar (outra aba, retomada). */
export async function iniciarAtendimento({ baseUrl, accountId, accessToken, dek, patientId, agendamentoId }: IniciarAtendimentoParams): Promise<Atendimento> {
  let agendamento = agendamentoId
  if (agendamento === undefined) {
    const criado = await agendarSessao(baseUrl, accountId, accessToken, patientId, new Date().toISOString(), DURACAO_PADRAO_MINUTOS)
    if (!criado.ok) throw new Error(translateProblemCode(criado.code, criado.params, i18n))
    agendamento = criado.sessionId
  }
  const registro = await getPatientRecord(baseUrl, accountId, accessToken, patientId)
  if (!registro.ok) throw new Error(translateProblemCode(registro.code, registro.params, i18n))
  const existente = (await openEntries(dek, registro.entries, patientId))
    .flatMap((bytes) => lerAtendimento(bytes, patientId) ?? [])
    .find((atendimento) => atendimento.agendamentoId === agendamento)
  if (existente !== undefined) return existente
  const atendimento: Atendimento = { id: crypto.randomUUID(), patientId, agendamentoId: agendamento, iniciadoEm: new Date().toISOString() }
  const sequence = registro.entries.length + 1
  const ciphertext = await sealEntry(dek, patientId, sequence, atendimentoParaEntrada(atendimento))
  const salvo = await appendPatientEntry(baseUrl, accountId, accessToken, patientId, { sequence, ciphertext })
  if (!salvo.ok) throw new Error(translateProblemCode(salvo.code, salvo.params, i18n))
  return atendimento
}
