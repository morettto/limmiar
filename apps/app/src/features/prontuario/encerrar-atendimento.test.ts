import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { dynamicActivate } from '../../shared/i18n'
import * as patients from '../../entities/patient/api'
import { openEntries, openRecord, sealEntry, sealNewPatient } from '../../entities/patient/patient-crypto'
import { atendimentoParaEntrada, encerramentoParaEntrada, lerEncerramento } from '../../entities/atendimento/atendimento'
import { encerrarAtendimento } from './encerrar-atendimento'

const data = '2026-10-13T15:00:00.000Z'
let dek: CryptoKey
let registro: Extract<patients.GetPatientRecordResult, { ok: true }>
const encerrar = () => encerrarAtendimento('', 'conta', 'token', 'paciente', 'sessao', dek)

async function acrescentar(bytes: Uint8Array<ArrayBuffer>) {
  const sequence = registro.entries.length + 1
  registro.entries.push({ sequence, entryId: `e${sequence}`, createdAt: data, ciphertext: await sealEntry(dek, 'paciente', sequence, bytes) })
}

beforeAll(async () => { await dynamicActivate('pt-BR') })
beforeEach(async () => {
  const kek = await webcrypto.importKek(new Uint8Array(32).fill(4))
  const selado = await sealNewPatient(kek, 'paciente', new TextEncoder().encode(JSON.stringify({ name: 'Paciente fictício', risk: 'baixo' })))
  registro = { ok: true, patientId: 'paciente', wrappedDek: selado.wrappedDek, createdAt: data, lastEntryAt: data,
    entries: [{ entryId: 'e1', sequence: 1, ciphertext: selado.ciphertext, createdAt: data }] }
  dek = (await openRecord(kek, registro, 'paciente')).dek
  await acrescentar(atendimentoParaEntrada({ id: 'sessao', patientId: 'paciente', agendamentoId: 'agenda', iniciadoEm: data }))
  vi.spyOn(patients, 'getPatientRecord').mockImplementation(async () => registro)
  vi.spyOn(patients, 'appendPatientEntry').mockImplementation(async (_base, _account, _token, _id, entry) => {
    registro.entries.push({ ...entry, entryId: `e${entry.sequence}`, createdAt: data })
    return { ok: true, entryId: `e${entry.sequence}`, sequence: entry.sequence, createdAt: data }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('encerrarAtendimento', () => {
  it('anexa o encerramento cifrado com autor, horário e sequência sem alterar as entradas salvas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T16:00:00Z'))
    const anteriores = registro.entries.slice()
    await encerrar()
    expect(patients.getPatientRecord).toHaveBeenCalledWith('', 'conta', 'token', 'paciente')
    expect(patients.appendPatientEntry).toHaveBeenCalledWith('', 'conta', 'token', 'paciente', expect.objectContaining({ sequence: 3 }))
    expect(registro.entries.slice(0, 2)).toEqual(anteriores)
    expect(new TextDecoder().decode(registro.entries[2]!.ciphertext)).not.toContain('encerramento-atendimento')
    const entradas = await openEntries(dek, registro.entries, 'paciente')
    expect(lerEncerramento(entradas[2]!)).toEqual({ atendimentoId: 'sessao', encerradoEm: '2026-10-13T16:00:00.000Z', autorId: 'conta' })
  })

  it('não duplica o encerramento depois de repetir a ação ou de outra aba já ter encerrado', async () => {
    await encerrar()
    await encerrar()
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
    vi.mocked(patients.appendPatientEntry).mockClear()
    await encerrar()
    expect(patients.appendPatientEntry).not.toHaveBeenCalled()
  })

  it('o encerramento de outra sessão não impede fechar a sessão atual', async () => {
    await acrescentar(encerramentoParaEntrada({ atendimentoId: 'outra', encerradoEm: data, autorId: 'conta' }))
    await encerrar()
    expect(patients.appendPatientEntry).toHaveBeenCalledWith('', 'conta', 'token', 'paciente', expect.objectContaining({ sequence: 4 }))
    const entradas = await openEntries(dek, registro.entries, 'paciente')
    expect(lerEncerramento(entradas[3]!)?.atendimentoId).toBe('sessao')
  })

  it.each(['registro', 'gravar'])('traduz a recusa da API ao %s e permite tentar novamente', async etapa => {
    if (etapa === 'registro') vi.mocked(patients.getPatientRecord).mockResolvedValueOnce({ ok: false, code: 'patients.not_found', params: {} })
    else vi.mocked(patients.appendPatientEntry).mockResolvedValueOnce({ ok: false, code: 'patients.entry_sequence_conflict', params: {} })
    await expect(encerrar()).rejects.toThrow()
    expect(registro.entries).toHaveLength(2)
    await expect(encerrar()).resolves.toBeUndefined()
    expect(registro.entries).toHaveLength(3)
  })

  it.each(['registro', 'gravar'])('propaga falha de rede ao %s sem marcar a sessão encerrada', async etapa => {
    const falha = new Error('Rede indisponível')
    if (etapa === 'registro') vi.mocked(patients.getPatientRecord).mockRejectedValueOnce(falha)
    else vi.mocked(patients.appendPatientEntry).mockRejectedValueOnce(falha)
    await expect(encerrar()).rejects.toBe(falha)
    expect(registro.entries).toHaveLength(2)
  })

  it('recusa entradas cifradas adulteradas antes de gravar o encerramento', async () => {
    const ciphertext = registro.entries[1]!.ciphertext
    ciphertext[0] = ciphertext[0]! ^ 1
    await expect(encerrar()).rejects.toThrow()
    expect(patients.appendPatientEntry).not.toHaveBeenCalled()
  })
})
