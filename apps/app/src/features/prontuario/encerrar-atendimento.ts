import { i18n } from '@lingui/core'
import type { CryptoKey } from '@limmiar/crypto'
import { encerramentoParaEntrada, lerEncerramento } from '../../entities/atendimento/atendimento'
import { appendPatientEntry, getPatientRecord } from '../../entities/patient/api'
import { openEntries, sealEntry } from '../../entities/patient/patient-crypto'
import { translateProblemCode } from '../../shared/api'

export async function encerrarAtendimento(baseUrl: string, accountId: string, accessToken: string,
  patientId: string, atendimentoId: string, dek: CryptoKey): Promise<void> {
  const registro = await getPatientRecord(baseUrl, accountId, accessToken, patientId)
  if (!registro.ok) throw new Error(translateProblemCode(registro.code, registro.params, i18n))
  const entradas = await openEntries(dek, registro.entries, patientId)
  if (entradas.some(bytes => lerEncerramento(bytes)?.atendimentoId === atendimentoId)) return
  const sequence = registro.entries.length + 1
  const ciphertext = await sealEntry(dek, patientId, sequence,
    encerramentoParaEntrada({ atendimentoId, autorId: accountId, encerradoEm: new Date().toISOString() }))
  const salvo = await appendPatientEntry(baseUrl, accountId, accessToken, patientId, { sequence, ciphertext })
  if (!salvo.ok) throw new Error(translateProblemCode(salvo.code, salvo.params, i18n))
}
