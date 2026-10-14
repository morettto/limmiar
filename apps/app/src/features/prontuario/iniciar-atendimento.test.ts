import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { dynamicActivate } from '../../shared/i18n'
import * as agenda from '../../entities/agenda/api'
import * as patients from '../../entities/patient/api'
import { openEntries, openRecord, sealEntry, sealNewPatient } from '../../entities/patient/patient-crypto'
import { atendimentoParaEntrada, lerAtendimento } from '../../entities/atendimento/atendimento'
import { iniciarAtendimento } from './iniciar-atendimento'

const data = '2026-10-01T12:00:00Z'
let dek: CryptoKey
let registro: Extract<patients.GetPatientRecordResult, { ok: true }>
const iniciar = (agendamentoId?: string) => iniciarAtendimento({ baseUrl: '', accountId: 'conta', accessToken: 'token', dek, patientId: 'paciente', agendamentoId })

beforeAll(async () => { await dynamicActivate('pt-BR') })
beforeEach(async () => {
  const kek = await webcrypto.importKek(new Uint8Array(32).fill(4))
  const selado = await sealNewPatient(kek, 'paciente', new TextEncoder().encode(JSON.stringify({ name: 'Paciente', risk: 'baixo' })))
  dek = (await openRecord(kek, { wrappedDek: selado.wrappedDek, entries: [{ sequence: 1, ciphertext: selado.ciphertext }] }, 'paciente')).dek
  registro = { ok: true, patientId: 'paciente', wrappedDek: selado.wrappedDek, createdAt: data, lastEntryAt: data,
    entries: [{ entryId: 'e1', sequence: 1, ciphertext: selado.ciphertext, createdAt: data }] }
  vi.spyOn(patients, 'getPatientRecord').mockImplementation(async () => registro)
  vi.spyOn(patients, 'appendPatientEntry').mockImplementation(async (_base, _account, _token, _id, entry) => {
    registro.entries.push({ ...entry, entryId: `e${entry.sequence}`, createdAt: data })
    return { ok: true, entryId: `e${entry.sequence}`, sequence: entry.sequence, createdAt: data }
  })
  vi.spyOn(agenda, 'agendarSessao').mockResolvedValue({ ok: true, sessionId: 'agendamento-agora' })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('iniciarAtendimento', () => {
  it('grava um atendimento cifrado para o agendamento pedido, sem criar outro agendamento', async () => {
    const atendimento = await iniciar('agendamento-1')
    expect(atendimento).toMatchObject({ patientId: 'paciente', agendamentoId: 'agendamento-1' })
    expect(agenda.agendarSessao).not.toHaveBeenCalled()
    expect(patients.appendPatientEntry).toHaveBeenCalledWith('', 'conta', 'token', 'paciente', expect.objectContaining({ sequence: 2 }))
    expect(new TextDecoder().decode(registro.entries[1]!.ciphertext)).not.toContain('agendamento-1')
    const entradas = await openEntries(dek, registro.entries, 'paciente')
    expect(lerAtendimento(entradas[1]!, 'paciente')).toEqual(atendimento)
  })

  it('sem agendamento, cria um agora (50 min) e liga o atendimento a ele', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T09:30:00Z'))
    const atendimento = await iniciar()
    expect(agenda.agendarSessao).toHaveBeenCalledWith('', 'conta', 'token', 'paciente', '2026-10-02T09:30:00.000Z', 50)
    expect(atendimento).toMatchObject({ agendamentoId: 'agendamento-agora', iniciadoEm: '2026-10-02T09:30:00.000Z' })
  })

  it('reaproveita o atendimento que já existe para o agendamento, inclusive criado por outra aba', async () => {
    const primeiro = await iniciar('agendamento-1')
    expect(await iniciar('agendamento-1')).toEqual(primeiro)
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
    const outraAba = { id: 'da-outra-aba', patientId: 'paciente', agendamentoId: 'agendamento-2', iniciadoEm: data }
    registro.entries.push({ entryId: 'e3', sequence: 3, createdAt: data, ciphertext: await sealEntry(dek, 'paciente', 3, atendimentoParaEntrada(outraAba)) })
    expect(await iniciar('agendamento-2')).toEqual(outraAba)
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
  })

  it.each(['agendar', 'registro', 'gravar'])('traduz a recusa da API ao %s', async (etapa) => {
    const problema = { ok: false as const, code: 'patients.not_found', params: {} }
    if (etapa === 'agendar') vi.mocked(agenda.agendarSessao).mockResolvedValue(problema)
    if (etapa === 'registro') vi.mocked(patients.getPatientRecord).mockResolvedValue(problema)
    if (etapa === 'gravar') vi.mocked(patients.appendPatientEntry).mockResolvedValue({ ok: false, code: 'patients.entry_sequence_conflict', params: {} })
    await expect(iniciar(etapa === 'agendar' ? undefined : 'agendamento-1')).rejects.toThrow()
  })
})
