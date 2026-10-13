import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate } from '../../shared/i18n'
import { listPatients, getPatientRecord } from '../../entities/patient/api'
import { sealEntry, sealNewPatient } from '../../entities/patient/patient-crypto'
import { obterAssinatura } from '../../entities/nota/api'
import { notaParaEntrada } from '../../entities/nota/nota-crypto'
import { ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'
import * as abrirNotasModulo from '../../entities/nota/abrir-notas'
import { carregarBiblioteca } from './carregar-biblioteca'

vi.mock('../../entities/patient/api', () => ({ listPatients: vi.fn(), getPatientRecord: vi.fn() }))
vi.mock('../../entities/nota/api', () => ({ obterAssinatura: vi.fn() }))
const kek = await webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
const paciente = await sealNewPatient(kek, 'paciente-real', new TextEncoder().encode(JSON.stringify({ name: 'Nome sintético', risk: 'baixo' })))
const nota: Nota = { id: 'nota', patientId: 'paciente-real', atendimentoId: 'atendimento', revisao: 0, estado: ESTADO_PENDENTE,
  frases: [{ id: 'S-0', secao: 'S', texto: 'Fala clínica sintética.', ancoras: [] }] }
const ciphertext = await sealEntry(paciente.dek, nota.patientId, 2, notaParaEntrada(nota))
const resumo = { patientId: nota.patientId, createdAt: '2026-10-03', wrappedDek: paciente.wrappedDek, ciphertext: paciente.ciphertext }
const registro = { ok: true as const, ...resumo, lastEntryAt: '2026-10-03', entries: [
  { sequence: 1, ciphertext: paciente.ciphertext, entryId: 'criacao', createdAt: '2026-10-03' },
  { sequence: 2, ciphertext, entryId: 'nota', createdAt: '2026-10-03' },
] }
const carregar = () => carregarBiblioteca('', 'conta', 'token', kek)
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(() => {
  vi.mocked(listPatients).mockReset().mockResolvedValue({ ok: true, patients: [resumo] })
  vi.mocked(getPatientRecord).mockReset().mockResolvedValue(registro)
  vi.mocked(obterAssinatura).mockReset().mockResolvedValue({ ok: false, code: 'notes.signature_not_found', params: {} })
})

describe('biblioteca real cifrada', () => {
  it('abre prontuário e nome somente no cliente, trazendo as notas da conta autenticada', async () => {
    const biblioteca = await carregar()
    expect(biblioteca.nomesPacientes.get(nota.patientId)).toBe('Nome sintético')
    expect(biblioteca.notas).toMatchObject([{ patientId: nota.patientId, frases: [{ texto: nota.frases[0]!.texto }] }])
    expect(listPatients).toHaveBeenCalledWith('', 'conta', 'token')
    expect(getPatientRecord).toHaveBeenCalledWith('', 'conta', 'token', nota.patientId)
    vi.mocked(listPatients).mockResolvedValue({ ok: true, patients: [] })
    expect((await carregar()).notas).toEqual([])
  })
  it('informa falhas da API e recusa resumo de paciente que não pode ser decifrado', async () => {
    vi.mocked(listPatients).mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })
    await expect(carregar()).rejects.toThrow('Você não tem acesso')
    vi.mocked(listPatients).mockResolvedValue({ ok: true, patients: [{ ...resumo, ciphertext: new Uint8Array(28) }] })
    await expect(carregar()).rejects.toThrow('Não foi possível abrir')
    expect(getPatientRecord).not.toHaveBeenCalled()
  })
  it('não transforma erro de prontuário em uma biblioteca vazia', async () => {
    vi.mocked(getPatientRecord).mockResolvedValue({ ok: false, code: 'patients.not_found', params: {} })
    await expect(carregar()).rejects.toThrow('Prontuário não encontrado.')
  })
  it('entrega às notas só as entradas que vêm depois da criação do prontuário', async () => {
    const abrir = vi.spyOn(abrirNotasModulo, 'abrirNotas')
    await carregar()
    expect(abrir.mock.calls[0]![0]).toHaveLength(1)
    abrir.mockRestore()
  })
})
