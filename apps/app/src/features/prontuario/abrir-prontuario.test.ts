import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { dynamicActivate } from '../../shared/i18n'
import * as patients from '../../entities/patient/api'
import * as consent from '../../entities/consentimento/api'
import * as signatures from '../../entities/nota/api'
import { openRecord, sealEntry, sealNewPatient } from '../../entities/patient/patient-crypto'
import { transcricaoParaEntrada, type Transcricao } from '../../entities/transcricao/transcricao'
import { atendimentoParaEntrada, encerramentoParaEntrada, type Atendimento } from '../../entities/atendimento/atendimento'
import { abrirProntuario } from './abrir-prontuario'

const data = '2026-10-01T12:00:00Z'
const transcricao: Transcricao = { id: 'sessao', patientId: 'paciente', revisao: 0, autorId: 'conta', registradaEm: data,
  palavras: [{ texto: 'Fala.', inicioMs: 0, fimMs: 500, locutor: 'A' }], papeis: { A: 'paciente' } }
const atendimento: Atendimento = { id: 'sessao', patientId: 'paciente', agendamentoId: 'agendamento', iniciadoEm: data }
let kek: CryptoKey
let registro: Extract<patients.GetPatientRecordResult, { ok: true }>

async function acrescentar(bytes: Uint8Array<ArrayBuffer>) {
  const { dek } = await openRecord(kek, registro, 'paciente')
  const sequence = registro.entries.length + 1
  registro.entries.push({ sequence, entryId: `e${sequence}`, createdAt: data, ciphertext: await sealEntry(dek, 'paciente', sequence, bytes) })
}
const abrir = () => abrirProntuario('', 'conta', 'token', kek, 'paciente')

beforeAll(async () => { await dynamicActivate('pt-BR') })
beforeEach(async () => {
  kek = await webcrypto.importKek(new Uint8Array(32).fill(4))
  const selado = await sealNewPatient(kek, 'paciente', new TextEncoder().encode(JSON.stringify({ name: 'Paciente fictício', risk: 'moderado' })))
  registro = { ok: true, patientId: 'paciente', wrappedDek: selado.wrappedDek, createdAt: data, lastEntryAt: data,
    entries: [{ entryId: 'e1', sequence: 1, ciphertext: selado.ciphertext, createdAt: data }] }
  vi.spyOn(patients, 'getPatientRecord').mockResolvedValue(registro)
  vi.spyOn(consent, 'obterConsentimentos').mockResolvedValue({ ok: true, consentimentos: { gravacao: 'concedido', analiseIa: 'pendente' } })
  vi.spyOn(signatures, 'obterAssinatura').mockResolvedValue({ ok: false, code: 'notes.signature_not_found', params: {} })
})
afterEach(() => vi.restoreAllMocks())

describe('abrirProntuario', () => {
  it('reabre a sessão encerrada preservando transcrição e sem encerrar outra sessão', async () => {
    const encerradoEm = '2026-10-13T16:00:00.000Z'
    const outra = { ...atendimento, id: 'outra', agendamentoId: 'agendamento-2' }
    await acrescentar(atendimentoParaEntrada(atendimento))
    await acrescentar(atendimentoParaEntrada(outra))
    await acrescentar(transcricaoParaEntrada(transcricao))
    await acrescentar(encerramentoParaEntrada({ atendimentoId: atendimento.id, encerradoEm, autorId: 'conta' }))
    const aberto = await abrir()
    expect(aberto.atendimentos).toEqual([{ ...atendimento, encerradoEm }, outra])
    expect(aberto.transcricoes).toEqual([transcricao])
    expect(aberto.notas).toEqual([])
  })
  it('decifra nome e risco da primeira entrada e traz consentimentos', async () => {
    const aberto = await abrir()
    expect(aberto).toMatchObject({ nome: 'Paciente fictício', risco: 'moderado', consentimentos: { gravacao: 'concedido', analiseIa: 'pendente' },
      transcricoes: [], notas: [], atendimentos: [] })
    expect(patients.getPatientRecord).toHaveBeenCalledWith('', 'conta', 'token', 'paciente')
    expect(consent.obterConsentimentos).toHaveBeenCalledWith('', 'conta', 'token', 'paciente')
  })

  it('separa transcrições, notas e atendimentos, ignorando entradas de outro tipo', async () => {
    await acrescentar(transcricaoParaEntrada(transcricao))
    await acrescentar(new TextEncoder().encode(JSON.stringify({ tipo: 'nota', noteId: 'nota-1', atendimentoId: 'sessao', revisao: 0, frases: [{ secao: 'S', texto: 'Relato', ancoras: [] }] })))
    await acrescentar(atendimentoParaEntrada(atendimento))
    await acrescentar(new TextEncoder().encode(JSON.stringify({ tipo: 'outro' })))
    const aberto = await abrir()
    expect(aberto.transcricoes).toEqual([transcricao])
    expect(aberto.notas.map((nota) => nota.id)).toEqual(['nota-1'])
    expect(aberto.atendimentos).toEqual([atendimento])
  })

  it.each(['registro', 'consentimentos'])('traduz a recusa da API em %s', async (recurso) => {
    const problema = { ok: false as const, code: 'patients.not_found', params: {} }
    if (recurso === 'registro') vi.mocked(patients.getPatientRecord).mockResolvedValue(problema)
    else vi.mocked(consent.obterConsentimentos).mockResolvedValue(problema)
    await expect(abrir()).rejects.toThrow()
  })

  it('recusa um prontuário cuja primeira entrada não é um resumo legível', async () => {
    const { dek } = await openRecord(kek, registro, 'paciente')
    registro.entries[0] = { ...registro.entries[0]!, ciphertext: await sealEntry(dek, 'paciente', 1, new TextEncoder().encode('{"name":""}')) }
    await expect(abrir()).rejects.toThrow('Não foi possível ler o paciente')
  })

  it('repassa a falha de uma assinatura de nota', async () => {
    await acrescentar(new TextEncoder().encode(JSON.stringify({ tipo: 'nota', noteId: 'nota-1', atendimentoId: 'sessao', revisao: 0, frases: [{ secao: 'S', texto: 'Relato', ancoras: [] }] })))
    vi.mocked(signatures.obterAssinatura).mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })
    await expect(abrir()).rejects.toThrow('Você não tem acesso')
  })
})
