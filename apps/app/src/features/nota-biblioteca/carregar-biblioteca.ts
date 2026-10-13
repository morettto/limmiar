import { t } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { CryptoKey } from '@limmiar/crypto'
import { abrirNotas } from '../../entities/nota/abrir-notas'
import { listPatients, getPatientRecord } from '../../entities/patient/api'
import { decryptSummaries } from '../../entities/patient/decrypt-summaries'
import { openRecord } from '../../entities/patient/patient-crypto'
import { translateProblemCode } from '../../shared/api'

export async function carregarBiblioteca(baseUrl: string, accountId: string, accessToken: string, kek: CryptoKey) {
  const lista = await listPatients(baseUrl, accountId, accessToken)
  if (!lista.ok) throw new Error(translateProblemCode(lista.code, lista.params, i18n))
  const resumos = await decryptSummaries(kek, lista.patients)
  const nomesPacientes = new Map<string, string>()
  const porPaciente = await Promise.all(resumos.map(async (paciente) => {
    if (!paciente.ok) throw new Error(t`Não foi possível abrir o prontuário de um paciente.`)
    nomesPacientes.set(paciente.patientId, paciente.name)
    const registro = await getPatientRecord(baseUrl, accountId, accessToken, paciente.patientId)
    if (!registro.ok) throw new Error(translateProblemCode(registro.code, registro.params, i18n))
    const aberto = await openRecord(kek, registro, paciente.patientId)
    return abrirNotas(aberto.plaintexts.slice(1), paciente.patientId, aberto.dek, baseUrl, accountId, accessToken)
  }))
  return { notas: porPaciente.flat(), nomesPacientes }
}
