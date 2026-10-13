import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import * as patients from '../../entities/patient/api'
import * as assinaturas from '../../entities/nota/api'
import { openEntries, sealNewPatient } from '../../entities/patient/patient-crypto'
import { lerNota } from '../../entities/nota/ler-nota'
import { verificarAssinatura } from '../../entities/nota/nota-crypto'
import type { Nota } from '../../entities/nota/nota'
import type { PropostaReferencia } from '../../entities/nota/referencia'
import type { Transcricao } from '../../entities/transcricao/transcricao'
import { NotaDoAtendimento, type NotaDoAtendimentoProps } from './NotaDoAtendimento'

const data = '2026-10-01T12:00:00Z'
const proposta: PropostaReferencia = { patientId: 'paciente', inicioMs: 100, fimMs: 900, referencia: {
  trechoId: 'fonte', titulo: 'Livro', autor: 'Autor', pagina: 4, paragrafo: 2, citacaoLiteral: 'Citação literal',
  transcriptId: 'atendimento', revisaoTranscricao: 0, frasePaciente: 'Tenho medo.',
} }
const transcricao: Transcricao = { id: 'atendimento', patientId: 'paciente', revisao: 0, registradaEm: data, autorId: 'conta',
  palavras: [{ texto: 'Antes.', inicioMs: 0, fimMs: 50, locutor: 'A' }, { texto: 'Tenho', inicioMs: 100, fimMs: 300, locutor: 'A' }, { texto: 'Conte.', inicioMs: 150, fimMs: 250, locutor: 'P' },
    { texto: 'Sem rótulo.', inicioMs: 320, fimMs: 380, locutor: null }, { texto: 'medo.', inicioMs: 600, fimMs: 900, locutor: 'A' },
    { texto: 'Depois.', inicioMs: 950, fimMs: 1000, locutor: 'A' }], papeis: { A: 'paciente', P: 'voce' } }
const gravada = (estado: Nota['estado'] = 'pendente', revisao = 2): Nota => ({ id: 'nota-gravada', patientId: 'paciente', atendimentoId: 'atendimento', revisao, estado,
  frases: [{ id: 'S-0', secao: 'S', texto: 'Queixa gravada', ancoras: [] }, { id: 'O-0', secao: 'O', texto: '', ancoras: [] },
    { id: 'A-0', secao: 'A', texto: '', ancoras: [] }, { id: 'P-0', secao: 'P', texto: '', ancoras: [] }] })

let dek: CryptoKey
let registro: Extract<patients.GetPatientRecordResult, { ok: true }>
const aoSalvar = vi.fn(), aoDescartar = vi.fn(), aoAbrir = vi.fn()

function elemento(props: Partial<NotaDoAtendimentoProps> = {}) {
  return <I18nProvider i18n={i18n}><NotaDoAtendimento baseUrl="" accountId="conta" accessToken="token" patientId="paciente" atendimentoId="atendimento" dek={dek}
    transcricoes={[transcricao]} analiseAutorizada ativa propostaReferencia={null} onDescartarProposta={aoDescartar} onAbrirTranscricao={aoAbrir} onSaved={aoSalvar} {...props} /></I18nProvider>
}
const montar = (props: Partial<NotaDoAtendimentoProps> = {}) => render(elemento(props))
const subjetivo = () => screen.getByRole('textbox', { name: 'Subjetivo 1' }) as HTMLTextAreaElement
const confirmar = () => screen.getByRole('button', { name: 'Confirmar referência na avaliação' })
async function notasGravadas() {
  return (await openEntries(dek, registro.entries, 'paciente')).flatMap(bytes => lerNota(bytes, 'paciente') ?? [])
}

describe('NotaDoAtendimento', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  beforeEach(async () => {
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(4))
    const selado = await sealNewPatient(kek, 'paciente', new TextEncoder().encode(JSON.stringify({ name: 'Paciente fictício', risk: 'baixo' })))
    dek = selado.dek
    registro = { ok: true, patientId: 'paciente', wrappedDek: selado.wrappedDek, createdAt: data, lastEntryAt: data,
      entries: [{ entryId: 'e1', sequence: 1, ciphertext: selado.ciphertext, createdAt: data }] }
    vi.spyOn(patients, 'getPatientRecord').mockResolvedValue(registro)
    vi.spyOn(patients, 'appendPatientEntry').mockImplementation(async (_base, _conta, _token, _paciente, entrada) => {
      registro.entries.push({ ...entrada, entryId: `e${entrada.sequence}`, createdAt: data })
      return { ok: true, entryId: `e${entrada.sequence}`, sequence: entrada.sequence, createdAt: data }
    })
    vi.spyOn(assinaturas, 'assinarNota').mockResolvedValue({ ok: true, noteId: 'nota', revision: 1, signedAt: data })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); aoSalvar.mockClear(); aoDescartar.mockClear(); aoAbrir.mockClear() })

  it('salva a nota da sessão cifrada no prontuário, avisa a página e não regrava a mesma revisão', async () => {
    montar()
    fireEvent.change(subjetivo(), { target: { value: 'Queixa fictícia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }))
    await screen.findByText('Nota salva no prontuário.')
    expect(aoSalvar).toHaveBeenCalledOnce()
    const [nota] = await notasGravadas()
    expect(nota).toMatchObject({ atendimentoId: 'atendimento', patientId: 'paciente', revisao: 1 })
    expect(nota!.frases[0]!.texto).toBe('Queixa fictícia')
    expect(new TextDecoder().decode(registro.entries[1]!.ciphertext)).not.toContain('Queixa fictícia')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }))
    await waitFor(() => expect(aoSalvar).toHaveBeenCalledTimes(2))
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
    expect(patients.getPatientRecord).toHaveBeenCalledOnce()
  })

  it('assina a nota gravada: a assinatura atesta o conteúdo e a nota passa a ser só de leitura', async () => {
    montar({ nota: gravada() })
    expect(subjetivo().value).toBe('Queixa gravada')
    fireEvent.click(screen.getByRole('button', { name: 'Assinar nota' }))
    await screen.findByText('Nota assinada e salva no prontuário.')
    expect(patients.appendPatientEntry).not.toHaveBeenCalled()
    const [, , , id, assinatura] = vi.mocked(assinaturas.assinarNota).mock.calls[0]!
    expect(id).toBe('nota-gravada')
    expect(assinatura.revision).toBe(2)
    expect(await verificarAssinatura(dek, gravada(), assinatura.signature)).toBe(true)
    expect(subjetivo().readOnly).toBe(true)
    expect((screen.getByRole('button', { name: 'Salvar nota' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Assinar nota' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(subjetivo(), { key: 'Enter', ctrlKey: true })
    expect(assinaturas.assinarNota).toHaveBeenCalledOnce()
  })

  it('abre uma nota já assinada somente para leitura e ignora o atalho de assinatura', () => {
    montar({ nota: gravada('assinada') })
    expect(subjetivo().readOnly).toBe(true)
    fireEvent.keyDown(subjetivo(), { key: 'Enter', ctrlKey: true })
    expect(assinaturas.assinarNota).not.toHaveBeenCalled()
    expect(patients.getPatientRecord).not.toHaveBeenCalled()
  })

  it('o atalho de assinatura funciona e não inicia outra escrita enquanto salva', async () => {
    montar()
    let resolver!: (resultado: patients.GetPatientRecordResult) => void
    vi.mocked(patients.getPatientRecord).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
    fireEvent.keyDown(subjetivo(), { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(subjetivo(), { key: 'Enter', ctrlKey: true })
    expect(patients.getPatientRecord).toHaveBeenCalledOnce()
    await act(async () => resolver(registro))
    await screen.findByText('Nota assinada e salva no prontuário.')
    expect(assinaturas.assinarNota).toHaveBeenCalledOnce()
  })

  it('salva a revisão antes da assinatura e permite repetir a assinatura sem duplicar a nota', async () => {
    vi.mocked(assinaturas.assinarNota).mockRejectedValueOnce(new Error('rede caiu'))
    montar()
    fireEvent.change(subjetivo(), { target: { value: 'Queixa fictícia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assinar nota' }))
    await screen.findByText('rede caiu')
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
    expect(subjetivo().readOnly).toBe(false)
    expect(aoSalvar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Assinar nota' }))
    await screen.findByText('Nota assinada e salva no prontuário.')
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
    expect(subjetivo().readOnly).toBe(true)
    expect(aoSalvar).toHaveBeenCalledOnce()
  })

  it.each([
    ['leitura do prontuário', 'patients.not_found', 'Prontuário não encontrado.'],
    ['escrita', 'patients.entry_sequence_conflict', 'Este prontuário mudou em outro dispositivo. Recarregue e tente de novo.'],
    ['assinatura', 'patients.not_found', 'Prontuário não encontrado.'],
    ['rede', 'falha sem objeto', 'Não foi possível concluir. Tente novamente.'],
  ])('mantém a nota editável quando falha %s', async (etapa, falha, texto) => {
    montar()
    if (etapa === 'leitura do prontuário') vi.mocked(patients.getPatientRecord).mockResolvedValueOnce({ ok: false, code: falha, params: {} })
    if (etapa === 'escrita') vi.mocked(patients.appendPatientEntry).mockResolvedValueOnce({ ok: false, code: falha, params: {} })
    if (etapa === 'assinatura') vi.mocked(assinaturas.assinarNota).mockResolvedValueOnce({ ok: false, code: falha, params: {} })
    if (etapa === 'rede') vi.mocked(patients.getPatientRecord).mockRejectedValueOnce(falha)
    fireEvent.click(screen.getByRole('button', { name: 'Assinar nota' }))
    await screen.findByRole('status')
    expect(subjetivo().readOnly).toBe(false)
    expect(aoSalvar).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe(texto)
  })

  it('só inclui a referência depois de confirmar, mantém a proveniência cifrada e não duplica', async () => {
    montar({ propostaReferencia: proposta })
    expect(patients.appendPatientEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Avaliação 1' })).toHaveProperty('value', '')
    fireEvent.click(confirmar())
    expect(screen.getByRole('textbox', { name: 'Avaliação 2' })).toHaveProperty('value', 'Referência selecionada para a fala: Tenho medo.')
    expect(aoDescartar).toHaveBeenCalledOnce()
    fireEvent.click(confirmar())
    expect(screen.queryByRole('textbox', { name: 'Avaliação 3' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }))
    await screen.findByText('Nota salva no prontuário.')
    const [nota] = await notasGravadas()
    expect(nota!.frases.at(-1)!.referencias).toEqual([proposta.referencia])
    expect(new TextDecoder().decode(registro.entries[1]!.ciphertext)).not.toContain('Livro')
    fireEvent.click(screen.getByRole('button', { name: 'Descartar referência' }))
    expect(aoDescartar).toHaveBeenCalledTimes(3)
  })

  it.each(['outro-paciente', 'revisao-antiga', 'frase-diferente', 'inicio-diferente', 'fim-diferente', 'sem-transcricao', 'sem-consentimento', 'nota-assinada', 'sem-palavras'])('recusa a referência incompatível e a submissão tardia: %s', (caso) => {
    const incompativel = { ...proposta, referencia: { ...proposta.referencia } }
    if (caso === 'outro-paciente') incompativel.patientId = 'outro'
    if (caso === 'revisao-antiga') incompativel.referencia.revisaoTranscricao = 1
    if (caso === 'frase-diferente') incompativel.referencia.frasePaciente = 'Outros sintomas.'
    if (caso === 'inicio-diferente') incompativel.inicioMs = 50
    if (caso === 'fim-diferente') incompativel.fimMs = 950
    if (caso === 'sem-transcricao') incompativel.referencia.transcriptId = 'inexistente'
    if (caso === 'sem-palavras') { incompativel.inicioMs = 2000; incompativel.fimMs = 3000 }
    montar({ propostaReferencia: incompativel, analiseAutorizada: caso !== 'sem-consentimento', nota: caso === 'nota-assinada' ? gravada('assinada') : undefined })
    expect((confirmar() as HTMLButtonElement).disabled).toBe(true)
    if (caso !== 'nota-assinada') expect(screen.getByText('A referência não corresponde à revisão atual de uma fala autorizada deste paciente.')).toBeTruthy()
    fireEvent.submit(screen.getByRole('form', { name: 'Referência para aprovação' }))
    expect(screen.queryByRole('textbox', { name: 'Avaliação 2' })).toBeNull()
    expect(aoDescartar).not.toHaveBeenCalled()
  })

  it('leva o foco à referência proposta só quando a aba da nota está à vista', () => {
    const view = montar({ propostaReferencia: proposta, ativa: false })
    const formulario = screen.getByRole('form', { name: 'Referência para aprovação' })
    expect(document.activeElement).not.toBe(formulario)
    view.rerender(elemento({ propostaReferencia: proposta, ativa: true }))
    expect(document.activeElement).toBe(formulario)
  })

  it('abre a transcrição da referência na sessão, e recusa a que não está entre as revisões dela', () => {
    const referencia = { ...proposta.referencia }
    const comReferencia = { ...gravada(), frases: [{ id: 'A-0', secao: 'A' as const, texto: 'Avaliação', ancoras: [], referencias: [referencia] }] }
    const view = montar({ nota: comReferencia })
    fireEvent.click(screen.getByText('Referência bibliográfica · Livro'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver fala da referência' }))
    expect(aoAbrir).toHaveBeenCalledOnce()
    view.rerender(elemento({ nota: comReferencia, transcricoes: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Ver fala da referência' }))
    expect(screen.getByText('Não foi possível abrir a transcrição desta referência.')).toBeTruthy()
    expect(aoAbrir).toHaveBeenCalledOnce()
  })

  it('abre sem aviso, com a seção nomeada, sem chaves repetidas e sem cobrar proposta', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    montar()
    expect(screen.getByRole('region', { name: 'Nota da sessão' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('form', { name: 'Referência para aprovação' })).toBeNull()
    expect(erro).not.toHaveBeenCalled()
  })

  it('a proposta aparece como formulário focável só por código e, ao confirmar, avisa que entrou no rascunho', () => {
    montar({ propostaReferencia: proposta })
    expect(screen.getByRole('form', { name: 'Referência para aprovação' }).tabIndex).toBe(-1)
    fireEvent.click(confirmar())
    expect(screen.getByRole('status').textContent).toBe('Referência incluída no rascunho. Confira a avaliação antes de salvar ou assinar.')
  })

  it('rola até a referência proposta quando a aba está à vista', () => {
    const rolar = vi.fn()
    Element.prototype.scrollIntoView = rolar
    try {
      montar({ propostaReferencia: proposta })
      expect(rolar).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', behavior: 'smooth' })
    } finally { Reflect.deleteProperty(Element.prototype, 'scrollIntoView') }
  })

  it('aceita a referência cuja fala tem três palavras do paciente, comparando o início e o fim certos', () => {
    const tres: Transcricao = { ...transcricao, palavras: [
      { texto: 'Tenho', inicioMs: 100, fimMs: 300, locutor: 'A' }, { texto: 'muito', inicioMs: 350, fimMs: 550, locutor: 'A' }, { texto: 'medo.', inicioMs: 600, fimMs: 900, locutor: 'A' },
    ] }
    const propostaTres = { ...proposta, referencia: { ...proposta.referencia, frasePaciente: 'Tenho muito medo.' } }
    montar({ propostaReferencia: propostaTres, transcricoes: [tres] })
    expect((confirmar() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('A referência não corresponde à revisão atual de uma fala autorizada deste paciente.')).toBeNull()
  })

  it('só abre a transcrição quando o identificador e a revisão são os de uma revisão da sessão', () => {
    const referencia = { ...proposta.referencia }
    const comReferencia = { ...gravada(), frases: [{ id: 'A-0', secao: 'A' as const, texto: 'Avaliação', ancoras: [], referencias: [referencia] }] }
    const view = montar({ nota: comReferencia, transcricoes: [{ ...transcricao, id: 'outra', revisao: 0 }] })
    fireEvent.click(screen.getByText('Referência bibliográfica · Livro'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver fala da referência' }))
    expect(screen.getByText('Não foi possível abrir a transcrição desta referência.')).toBeTruthy()
    view.rerender(elemento({ nota: comReferencia, transcricoes: [{ ...transcricao, revisao: 3 }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Ver fala da referência' }))
    expect(aoAbrir).not.toHaveBeenCalled()
  })
})
