import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from '@limmiar/crypto'
import * as patients from '../../entities/patient/api'
import { openEntries, sealEntry, sealNewPatient } from '../../entities/patient/patient-crypto'
import { lerTranscricao, transcricaoParaEntrada, type Transcricao } from '../../entities/transcricao/transcricao'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import { transcreverLocal } from './transcrever-local'
import { transcreverAoVivo } from './transcrever-ao-vivo'
import { transcreverOnline } from './transcrever-online'
import { SessionReview, type SessionReviewProps } from './SessionReview'
import { abrirPerfilDeVoz } from './perfil-de-voz'
import { prepareAuthorizedMaterials } from '../../entities/material/authorized-materials'
import { consultarInsight } from '../../entities/insight/insight'
import { lerVotos } from '../../entities/insight/voto-store'

vi.mock('./transcrever-local', () => ({ transcreverLocal: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a> }))
vi.mock('./transcrever-ao-vivo', async importOriginal => ({ ...await importOriginal<typeof import('./transcrever-ao-vivo')>(), transcreverAoVivo: vi.fn() }))
vi.mock('./transcrever-online', async importOriginal => ({ ...await importOriginal<typeof import('./transcrever-online')>(), transcreverOnline: vi.fn() }))
vi.mock('./perfil-de-voz', () => ({ abrirPerfilDeVoz: vi.fn(async () => [1, 0]) }))
vi.mock('../../entities/insight/insight', () => ({ consultarInsight: vi.fn(async () => ({ cartoes: [], clarificar: false, alerta_risco: false, completo: true, juiz: 'v7' })) }))
vi.mock('../../entities/material/authorized-materials', () => ({ prepareAuthorizedMaterials: vi.fn(async () => ({ materialIds: ['m1'], pending: 0, materials: [{ materialId: 'm1', title: 'Obra de teste', ready: true }] })) }))
const aoVivo = vi.mocked(transcreverAoVivo)
const abrirPerfil = vi.mocked(abrirPerfilDeVoz)
const encerrarSessao = vi.fn(async () => {})
const pausarSessao = vi.fn()
const transcrever = vi.mocked(transcreverLocal)
const pendencias = vi.fn()
const props = { baseUrl: '', accountId: 'conta', accessToken: 'token', kek: {} as CryptoKey, atendimentoId: 'atendimento', onPendingChange: pendencias }
let paciente: SessionReviewProps['paciente']
let registro: Extract<patients.GetPatientRecordResult, { ok: true }>
const armazenamento = vi.fn()
const criarUrl = vi.fn((_blob: Blob) => 'blob:audio-local')
const revogarUrl = vi.fn()
const parar = vi.fn()
const getUserMedia = vi.fn()
let gravadores: Gravador[]
class Gravador extends EventTarget {
  state = 'inactive'
  mimeType = 'audio/webm'
  readonly stream: MediaStream
  constructor(stream: MediaStream) { super(); this.stream = stream; gravadores.push(this) }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new NodeBlob(['fala']) })); this.dispatchEvent(new Event('stop')) }
}
async function montar(pendente = false, extras: Partial<SessionReviewProps> = {}) {
  const view = render(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} {...extras} /></I18nProvider>)
  await waitFor(() => expect(pendencias.mock.lastCall?.[0]).toBe(pendente))
  return view
}
function enviar(size?: number) {
  const arquivo = new NodeBlob(['audio fictício'], { type: 'audio/wav' })
  if (size) Object.defineProperty(arquivo, 'size', { value: size })
  fireEvent.change(screen.getByLabelText('Ou carregar áudio'), { target: { files: [arquivo] } })
}
describe('SessionReview', () => {
  it('mostra obras prontas, deixa selecionar e grava a seleção junto da transcrição', async () => {
    const salva: Transcricao = { id: 'atendimento', patientId: 'paciente', revisao: 0, autorId: 'conta', registradaEm: '2026-10-02T12:00:00Z',
      palavras: [{ texto: 'Fala', locutor: 'paciente', inicioMs: 0, fimMs: 1000 }], papeis: { paciente: 'paciente' }, materialIds: ['m1'] }
    registro.entries.push({ entryId: 'e2', sequence: 2, createdAt: '', ciphertext: await sealEntry(paciente.dek, paciente.id, 2, transcricaoParaEntrada(salva)) })
    paciente.transcricoes = [salva]
    await montar(false, { transcricao: salva })
    const obra = await screen.findByRole('checkbox', { name: 'Obra de teste' })
    expect(obra).toHaveProperty('checked', true)
    fireEvent.click(obra)
    fireEvent.click(obra)
    expect(obra).toHaveProperty('checked', true)
    fireEvent.click(obra)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText('Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.')
    const entradas = await openEntries(paciente.dek, registro.entries, paciente.id)
    expect(lerTranscricao(entradas.at(-1)!, paciente.id)!.materialIds).toEqual([])
  })

  it('obra em preparação não pode ser escolhida e finalização bloqueia nova captura', async () => {
    vi.mocked(prepareAuthorizedMaterials).mockResolvedValueOnce({ materialIds: [], pending: 1, materials: [{ materialId: 'm1', title: 'Obra preparando', ready: false }] })
    await montar(false, { bloqueada: true })
    const obra = await screen.findByRole('checkbox', { name: /^Obra preparando/ })
    expect(obra).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Iniciar gravação' })).toHaveProperty('disabled', true)
  })

  it('atualiza obra preparada em segundo plano sem mudar a seleção do profissional', async () => {
    vi.mocked(prepareAuthorizedMaterials).mockResolvedValueOnce({ materialIds: [], pending: 1, materials: [{ materialId: 'm1', title: 'Obra de teste', ready: false }] })
    await montar()
    await waitFor(() => expect(prepareAuthorizedMaterials).toHaveBeenCalledTimes(2), { timeout: 2500 })
    const obra = screen.getByRole('checkbox', { name: 'Obra de teste' })
    expect(obra).toHaveProperty('disabled', false)
    expect(obra).toHaveProperty('checked', false)
  })

  it('recusa arquivo entregue depois da revogação do consentimento', async () => {
    paciente.consentimentos.gravacao = 'revogado'
    await montar()
    enviar()
    expect(transcrever).not.toHaveBeenCalled()
    expect(criarUrl).not.toHaveBeenCalled()
  })

  it('falha da conexão após iniciar o áudio encerra o gravador e não analisa uma captura abandonada', async () => {
    aoVivo.mockRejectedValueOnce(new Error('socket recusado'))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByText('Não foi possível iniciar a gravação.')
    expect(gravadores[0]!.state).toBe('inactive')
    expect(transcrever).not.toHaveBeenCalled()
  })

  it('descartar uma correção recupera o texto e a ausência de obras da revisão anterior', async () => {
    const salva: Transcricao = { id: 'atendimento', patientId: 'paciente', revisao: 0, autorId: 'conta', registradaEm: '2026-10-02T12:00:00Z',
      palavras: [{ texto: 'Original', locutor: 'paciente', inicioMs: 0, fimMs: 1000 }], papeis: { paciente: 'paciente' } }
    paciente.transcricoes = [salva]
    await montar(false, { transcricao: salva })
    fireEvent.change(screen.getByLabelText('Texto aos 0.0s'), { target: { value: 'Alterado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect(screen.getByLabelText('Texto aos 0.0s')).toHaveProperty('value', 'Original')
    expect(screen.getByRole('checkbox', { name: 'Obra de teste' })).toHaveProperty('checked', false)
  })

  it('falha durante a abertura não tenta parar um gravador já inativo que ainda não notificou o fim', async () => {
    const abertura = deferred<Awaited<ReturnType<typeof transcreverAoVivo>>>()
    aoVivo.mockReturnValueOnce(abertura.promise)
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await waitFor(() => expect(aoVivo).toHaveBeenCalledOnce())
    gravadores[0]!.state = 'inactive'
    await act(async () => abertura.reject(new Error('abertura perdida')))
    expect(screen.getByText('Não foi possível iniciar a gravação.')).toBeTruthy()
  })
  it('prepara o perfil antes do clique, usa uma cópia na captura e apaga o cache ao sair', async () => {
    const original = [0.7, 0.3]
    abrirPerfil.mockResolvedValueOnce(original)
    const view = await montar()
    expect(abrirPerfil).toHaveBeenCalledOnce()
    const sinal = abrirPerfil.mock.lastCall![4]
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    expect(abrirPerfil).toHaveBeenCalledOnce()
    const entregue = aoVivo.mock.lastCall![4]
    expect(entregue).toMatchObject({ perfil: original })
    expect('perfil' in entregue && entregue.perfil).not.toBe(original)
    view.unmount()
    expect(sinal.aborted).toBe(true)
    expect(original).toEqual([0, 0])
  })

  it('sessão encerrada bloqueia nova captura e arquivo sem abrir o perfil', async () => {
    await montar(false, { encerrada: true })
    expect((screen.getByRole('button', { name: 'Iniciar gravação' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Ou carregar áudio') as HTMLInputElement).disabled).toBe(true)
    expect(abrirPerfil).not.toHaveBeenCalled()
  })

  it('encerrar sessão presencial para o gravador e aguarda a transcrição terminar', async () => {
    const preparar = vi.fn()
    const fim = deferred<void>()
    encerrarSessao.mockReturnValue(fim.promise)
    await montar(false, { prepararEncerramento: preparar })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    const terminou = vi.fn()
    let encerramento!: Promise<void>
    await act(async () => { encerramento = preparar.mock.lastCall![0]().then(terminou) })
    expect(gravadores[0]!.state).toBe('inactive')
    expect(encerrarSessao).toHaveBeenCalled()
    expect(terminou).not.toHaveBeenCalled()
    await act(async () => { fim.resolve(); await encerramento })
    expect(terminou).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Pausar sessão' })).toBeNull()
    encerrarSessao.mockResolvedValue(undefined)
  })

  it.each([false, true])('permite fonte vinculada à revisão salva e impede uso enquanto chamada ativa: %s', async ativa => {
    const selected: Transcricao = { id: 'atendimento', patientId: 'paciente', revisao: 2, autorId: 'conta', materialIds: ['m1'], registradaEm: '2026-10-02T12:00:00Z',
      palavras: [{ texto: 'Tenho medo.', inicioMs: 100, fimMs: 900, locutor: 'A' }], papeis: { A: 'paciente' } }
    const fonte = { trecho_id: 'fonte', titulo: 'Livro', autor: 'Autor', pagina: 4, paragrafo: 2, citacao_literal: 'Citação literal', fenomeno_na_fala: 'Medo', fenomeno_no_trecho: 'Medo', probabilidade: 0.995, nivel: 'forte' as const }
    vi.mocked(consultarInsight).mockResolvedValueOnce({ cartoes: [fonte], clarificar: false, alerta_risco: false, completo: true, juiz: 'v7' })
    const onPropostaReferencia = vi.fn()
    render(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} transcricao={selected} onPropostaReferencia={onPropostaReferencia}
      online={ativa ? { ativa: true, local: null, remoto: null } : undefined} /></I18nProvider>)
    const button = await screen.findByRole('button', { name: 'Usar na nota' })
    expect(button).toHaveProperty('disabled', ativa)
    fireEvent.click(button)
    if (ativa) expect(onPropostaReferencia).not.toHaveBeenCalled()
    else expect(onPropostaReferencia).toHaveBeenCalledWith({ patientId: 'paciente', inicioMs: 100, fimMs: 900,
      referencia: { trechoId: 'fonte', titulo: 'Livro', autor: 'Autor', pagina: 4, paragrafo: 2, citacaoLiteral: 'Citação literal',
        transcriptId: 'atendimento', revisaoTranscricao: 2, frasePaciente: 'Tenho medo.' } })
  })
  it('abre o perfil de voz, entrega-o à captura e já mostra quem é quem; a correção manual prevalece', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    expect(abrirPerfil).toHaveBeenCalledWith('', 'conta', 'token', props.kek, expect.any(AbortSignal))
    expect(aoVivo.mock.lastCall![4]).toEqual({ trilhas: 'proprias', perfil: [1, 0] })
    const transcricao = { palavras: [
      { texto: 'Profissional', inicioMs: 0, fimMs: 1000, locutor: 'profissional' },
      { texto: 'Paciente', inicioMs: 1000, fimMs: 3000, locutor: 'paciente' },
      { texto: 'Visita', inicioMs: 3000, fimMs: 3500, locutor: 'pessoa_2' },
      { texto: 'Hipótese', inicioMs: 3500, fimMs: 3900, locutor: null },
    ], finais: 3, estavelAteMs: 3501 }
    act(() => { aoVivo.mock.lastCall![2](transcricao) })
    expect(screen.getByRole('combobox', { name: /^Voz 1$/ })).toHaveProperty('value', 'voce')
    expect(screen.getByRole('combobox', { name: /^Voz 2$/ })).toHaveProperty('value', 'paciente')
    expect(screen.getByRole('combobox', { name: /^Voz 3$/ })).toHaveProperty('value', '')
    fireEvent.change(screen.getByRole('combobox', { name: /^Voz 2$/ }), { target: { value: '' } })
    act(() => { aoVivo.mock.lastCall![2](transcricao) })
    expect(screen.getByRole('combobox', { name: /^Voz 2$/ })).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar gravação' }))
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
  })
  it('não grava sem saber quem fala: perfil que não abre', async () => {
    abrirPerfil.mockRejectedValueOnce(new Error('perfil indisponível'))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Seu perfil de voz não pôde ser aberto. Sem ele não dá para saber quem está falando.'))
    expect(aoVivo).not.toHaveBeenCalled()
    expect(gravadores[0]!.state).toBe('inactive')
    expect(parar).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Encerrar gravação' })).toBeNull()
  })
  it('não grava sem saber quem fala: voz não cadastrada', async () => {
    abrirPerfil.mockResolvedValueOnce(null)
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Cadastre sua voz antes de gravar: é preciso saber quem está falando.'))
    expect(aoVivo).not.toHaveBeenCalled()
    expect(parar).toHaveBeenCalledOnce()
  })
  it.each(['concluir', 'falhar'])('encerra o microfone se o perfil demorar a %s depois da saída', async (etapa) => {
    let liberar!: (resultado: number[] | null) => void
    let rejeitar!: (erro: Error) => void
    abrirPerfil.mockImplementationOnce(() => new Promise((resolve, reject) => { liberar = resolve; rejeitar = reject }))
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await waitFor(() => expect(abrirPerfil).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => {
      if (etapa === 'concluir') liberar(null)
      else rejeitar(new Error('falha tardia'))
    })
    expect(parar).toHaveBeenCalledOnce()
    expect(aoVivo).not.toHaveBeenCalled()
  })
  it('avisa a queda da conexão com a transcrição e o atraso, e tira o aviso quando tudo volta ao normal', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    const palavras = [{ texto: 'Fala', inicioMs: 0, fimMs: 500, locutor: 'A' }]
    const publicar = (aviso?: 'reconectando' | 'atrasada') => act(() => aoVivo.mock.lastCall![2]({ palavras, finais: 1, estavelAteMs: 501, ...(aviso && { aviso }) }))
    publicar('reconectando')
    expect(screen.getByText('A conexão com a transcrição caiu. Reconectando: o que for dito agora será transcrito assim que ela voltar.')).toBeTruthy()
    publicar('atrasada')
    expect(screen.queryByText(/A conexão com a transcrição caiu/)).toBeNull()
    expect(screen.getByText('A transcrição está atrasada em relação à fala. O áudio continua sendo enviado.')).toBeTruthy()
    publicar()
    expect(screen.queryByText(/está atrasada/)).toBeNull()
  })
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  beforeEach(async () => {
    vi.mocked(prepareAuthorizedMaterials).mockResolvedValue({ materialIds: ['m1'], pending: 0, materials: [{ materialId: 'm1', title: 'Obra de teste', ready: true }] })
    Object.defineProperty(navigator, 'storage', { value: { getDirectory: armazenamento }, configurable: true })
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(3))
    props.kek = kek
    const selado = await sealNewPatient(kek, 'paciente', new TextEncoder().encode(JSON.stringify({ name: 'Paciente fictício' })))
    paciente = { id: 'paciente', nome: 'Paciente fictício', dek: selado.dek, transcricoes: [], consentimentos: { gravacao: 'concedido', analiseIa: 'concedido' } }
    registro = { ok: true, patientId: paciente.id, wrappedDek: selado.wrappedDek, createdAt: '2026-10-02T12:00:00Z', lastEntryAt: '2026-10-02T12:00:00Z',
      entries: [{ entryId: 'criacao', sequence: 1, ciphertext: selado.ciphertext, createdAt: '2026-10-02T12:00:00Z' }] }
    vi.spyOn(patients, 'getPatientRecord').mockResolvedValue(registro)
    vi.spyOn(patients, 'appendPatientEntry').mockImplementation(async (_base, _account, _token, _patient, entrada) => {
      registro.entries.push({ ...entrada, entryId: `entrada-${entrada.sequence}`, createdAt: '2026-10-02T12:00:00Z' })
      return { ok: true, entryId: `entrada-${entrada.sequence}`, sequence: entrada.sequence, createdAt: '2026-10-02T12:00:00Z' }
    })
    gravadores = []
    vi.stubGlobal('Blob', NodeBlob)
    vi.stubGlobal('MediaRecorder', Gravador)
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    Object.defineProperty(URL, 'createObjectURL', { value: criarUrl, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revogarUrl, configurable: true })
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: parar }] })
    aoVivo.mockResolvedValue({ encerrar: encerrarSessao, pausar: pausarSessao })
    vi.mocked(transcreverOnline).mockResolvedValue({ encerrar: encerrarSessao, pausar: pausarSessao })
    transcrever.mockResolvedValue([
      { texto: 'Profissional fala', inicioMs: 0, fimMs: 1000, locutor: 'profissional' },
      { texto: 'Paciente fala', inicioMs: 1100, fimMs: 2000, locutor: 'paciente' },
      { texto: 'Voz sem identificação', inicioMs: 2100, fimMs: 3000, locutor: null },
    ])
  })
  afterEach(async () => { cleanup(); await act(async () => {}); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })
  it('abre com a última revisão da sessão, sem permitir uma segunda gravação, e lista só as revisões dela', async () => {
    const revisao = (id: string, numero: number, texto: string): Transcricao => ({ id, patientId: 'paciente', revisao: numero, autorId: 'conta', materialIds: ['m1'], registradaEm: '2026-10-02T12:00:00Z',
      palavras: [{ texto, inicioMs: 0, fimMs: 500, locutor: 'A' }], papeis: { A: 'paciente' } })
    const primeira = revisao('atendimento', 0, 'Fala antiga.'), ultima = revisao('atendimento', 1, 'Fala histórica.')
    paciente.transcricoes = [primeira, revisao('outra-sessao', 0, 'Fala de outra sessão.'), ultima]
    await montar(false, { transcricao: ultima })
    expect(screen.getByRole('textbox', { name: 'Texto aos 0.0s' })).toHaveProperty('value', 'Fala histórica.')
    expect(screen.getByText('Transcrição recuperada do prontuário. O áudio não é armazenado.')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho.' })).toHaveProperty('checked', true)
    expect((screen.getByRole('button', { name: 'Iniciar gravação' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Ou carregar áudio') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Revisões e correções', { exact: false }).textContent).toContain('(2)')
    expect(screen.queryByText('Fala de outra sessão.')).toBeNull()
  })
  it('avisa a pasta depois da escrita cifrada e recompõe bibliografia autorizada', async () => {
    const saved = vi.fn()
    vi.mocked(prepareAuthorizedMaterials).mockResolvedValueOnce({ materialIds: ['private'], pending: 1, materials: [{ materialId: 'private', title: 'Obra privada', ready: true }] })
    render(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} onSaved={saved} /></I18nProvider>)
    await screen.findByText('Há materiais autorizados que não estão prontos nesta máquina. Verifique seu acervo pessoal.')
    await revisar()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText(/Transcrição salva no prontuário/)
    expect(saved).toHaveBeenCalledOnce()
    expect(saved.mock.lastCall![0].patientId).toBe('paciente')
    expect(prepareAuthorizedMaterials).toHaveBeenCalledWith({ baseUrl: '', accountId: 'conta', accessToken: 'token' }, props.kek)
  })
  it('falha e resposta tardia do preparo não alteram paciente depois de sair', async () => {
    vi.mocked(prepareAuthorizedMaterials).mockRejectedValueOnce(new Error('offline'))
    const failed = await montar()
    await screen.findByText('Há materiais autorizados que não estão prontos nesta máquina. Verifique seu acervo pessoal.')
    failed.unmount()
    let resolve!: (value: Awaited<ReturnType<typeof prepareAuthorizedMaterials>>) => void
    vi.mocked(prepareAuthorizedMaterials).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const late = await montar(); late.unmount()
    await act(async () => resolve({ materialIds: [], pending: 0, materials: [] }))
    vi.mocked(prepareAuthorizedMaterials).mockRejectedValueOnce(new Error('late'))
    const lateError = render(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>); lateError.unmount(); await act(async () => {})
  })
  describe('transcrição da chamada online', () => {
    const local = {} as MediaStream, remoto = {} as MediaStream
    const online = { local, remoto, ativa: true }
    const apresentar = (entrada = online, prepararEncerramento?: SessionReviewProps['prepararEncerramento']) =>
      <I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} online={entrada} prepararEncerramento={prepararEncerramento} /></I18nProvider>
    const publicar = () => vi.mocked(transcreverOnline).mock.lastCall![3]({ palavras: [
      { texto: 'Estou', inicioMs: 200, fimMs: 350, locutor: 'online-paciente' },
      { texto: 'aqui.', inicioMs: 200, fimMs: 450, locutor: 'online-paciente' },
      { texto: 'Pode falar.', inicioMs: 10, fimMs: 180, locutor: 'online-profissional' },
    ], finais: 3, estavelAteMs: 500 })
    it('usa as trilhas originais com papéis fixos, finaliza o texto e salva apenas sua versão cifrada', async () => {
      let finalizar!: () => Promise<void>
      render(apresentar(online, callback => { finalizar = callback }))
      await screen.findByText('Transcrição online ao vivo. Cada trilha identifica quem está falando.')
      expect(transcreverOnline).toHaveBeenCalledWith(local, remoto, expect.any(AbortSignal), expect.any(Function), expect.any(Function), expect.any(Number))
      expect(getUserMedia).not.toHaveBeenCalled(); expect(abrirPerfil).not.toHaveBeenCalled()
      expect(gravadores).toHaveLength(0)
      expect(screen.queryByRole('button', { name: 'Iniciar gravação' })).toBeNull()
      act(publicar)
      expect(screen.getByText('Estou aqui.')).toBeTruthy()
      expect(screen.getByText('Pode falar.')).toBeTruthy()
      expect(screen.queryByRole('combobox', { name: /^Voz 1$/ })).toBeNull()
      expect(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho.' })).toHaveProperty('disabled', true)
      await act(async () => finalizar())
      fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho.' }))
      fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
      await screen.findByText('Transcrição salva no prontuário. Somente texto, tempos e identificação das falas foram armazenados.')
      const abertas = await openEntries(paciente.dek, registro.entries, paciente.id)
      const salva = abertas.map(bytes => lerTranscricao(bytes, paciente.id)).find(entrada => entrada !== null)!
      expect(salva.papeis).toEqual({ 'online-profissional': 'voce', 'online-paciente': 'paciente' })
      expect(salva.palavras.map(palavra => palavra.texto)).toEqual(['Pode falar.', 'Estou', 'aqui.'])
      expect(JSON.stringify(vi.mocked(patients.appendPatientEntry).mock.calls)).not.toContain('Estou')
    })
    it('mostra o aviso de conexão que vier de uma das trilhas', async () => {
      render(apresentar())
      await screen.findByText('Transcrição online ao vivo. Cada trilha identifica quem está falando.')
      act(() => vi.mocked(transcreverOnline).mock.lastCall![3]({ palavras: [], finais: 0, estavelAteMs: 0, aviso: 'reconectando' }))
      expect(screen.getByText(/A conexão com a transcrição caiu/)).toBeTruthy()
    })
    it.each(['local', 'remoto', 'conexao', 'microfone', 'ia'])('aguarda %s antes de iniciar a transcrição', async motivo => {
      const entrada: SessionReviewProps['online'] = { ...online }
      if (motivo === 'local') entrada.local = null
      if (motivo === 'remoto') entrada.remoto = null
      if (motivo === 'conexao') entrada.ativa = false
      if (motivo === 'microfone') paciente.consentimentos.gravacao = 'revogado'
      if (motivo === 'ia') paciente.consentimentos.analiseIa = 'revogado'
      const view = render(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} online={entrada} /></I18nProvider>)
      await act(async () => {})
      expect(transcreverOnline).not.toHaveBeenCalled()
      view.rerender(apresentar())
    })
    it('fecha a época anterior antes de reconectar e conserva as frases recebidas durante o fechamento', async () => {
      let concluir!: () => void
      encerrarSessao.mockImplementationOnce(() => new Promise<void>(resolve => { concluir = resolve }))
      const view = render(apresentar())
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
      act(publicar)
      const novoRemoto = {} as MediaStream
      view.rerender(apresentar({ ...online, remoto: novoRemoto }))
      await act(async () => {})
      expect(transcreverOnline).toHaveBeenCalledOnce()
      await act(async () => concluir())
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledTimes(2))
      act(() => vi.mocked(transcreverOnline).mock.lastCall![3]({ palavras: [
        { texto: 'Voltei.', inicioMs: 1500, fimMs: 2000, locutor: 'online-paciente' },
      ], finais: 1, estavelAteMs: 2000 }))
      expect(screen.getByText('Estou aqui.')).toBeTruthy()
      expect(screen.getByText('Voltei.')).toBeTruthy()
      expect(vi.mocked(transcreverOnline).mock.lastCall![1]).toBe(novoRemoto)
    })
    it('informa erro do serviço e recusa atualizações após revogar a análise', async () => {
      const view = render(apresentar())
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
      const [, , signal, atualizar, falhar] = vi.mocked(transcreverOnline).mock.lastCall!
      act(() => falhar(new Error('serviço indisponível')))
      expect(screen.getByRole('alert').textContent).toBe('serviço indisponível')
      act(publicar)
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, analiseIa: 'revogado' } }
      view.rerender(apresentar())
      expect(signal.aborted).toBe(true)
      await act(async () => { atualizar({ palavras: [], finais: 0, estavelAteMs: 0 }); falhar(new Error('erro tardio')) })
      expect(screen.queryByText('Estou aqui.')).toBeNull()
      expect(screen.queryByText('erro tardio')).toBeNull()
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, analiseIa: 'concedido' } }
      view.rerender(apresentar())
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledTimes(2))
      act(() => vi.mocked(transcreverOnline).mock.lastCall![3]({ palavras: [
        { texto: 'Nova autorização.', inicioMs: 0, fimMs: 100, locutor: 'online-paciente' },
      ], finais: 1, estavelAteMs: 100 }))
      expect(screen.getByText('Nova autorização.')).toBeTruthy()
      expect(screen.queryByText('Estou aqui.')).toBeNull()
    })
    it('informa falha ao iniciar sem criar um gravador', async () => {
      vi.mocked(transcreverOnline).mockRejectedValueOnce(new Error('offline'))
      render(apresentar())
      await screen.findByText('Não foi possível transcrever a chamada. O áudio não foi salvo.')
      expect(gravadores).toHaveLength(0)
    })
    it('não abre o serviço se a chamada for removida antes de executar a fila', async () => {
      const view = render(apresentar())
      view.unmount()
      await act(async () => {})
      expect(transcreverOnline).not.toHaveBeenCalled()
    })
    it('ignora falha tardia de fechamento depois de desmontar', async () => {
      encerrarSessao.mockRejectedValueOnce(new Error('tardio'))
      const view = render(apresentar())
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
      view.unmount()
      await act(async () => {})
      expect(encerrarSessao).toHaveBeenCalledOnce()
    })
    it.each(['concluir', 'falhar'])('cancela a abertura pendente e ignora %s após sair da página', async resultado => {
      let concluir!: (sessao: Awaited<ReturnType<typeof transcreverOnline>>) => void
      let rejeitar!: (erro: Error) => void
      vi.mocked(transcreverOnline).mockImplementationOnce(() => new Promise((resolve, reject) => { concluir = resolve; rejeitar = reject }))
      let finalizar!: () => Promise<void>
      const view = render(apresentar(online, callback => { finalizar = callback }))
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
      const [, , signal, atualizar, falhar] = vi.mocked(transcreverOnline).mock.lastCall!
      view.unmount()
      expect(signal.aborted).toBe(true)
      await act(async () => {
        atualizar({ palavras: [], finais: 0, estavelAteMs: 0 }); falhar(new Error('tardio'))
        if (resultado === 'concluir') concluir({ encerrar: encerrarSessao, pausar: pausarSessao })
        else rejeitar(new Error('offline'))
        await finalizar()
      })
      expect(getUserMedia).not.toHaveBeenCalled()
    })
    it('recupera o texto quando o fechamento da trilha falha e permite revisar', async () => {
      const view = render(apresentar())
      await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
      act(publicar)
      encerrarSessao.mockRejectedValueOnce(new Error('conexão interrompida'))
      view.rerender(apresentar({ ...online, ativa: false }))
      await screen.findByText('A transcrição foi interrompida. Revise o texto recuperado.')
      expect(screen.getByText('Estou aqui.')).toBeTruthy()
      expect(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho.' })).toHaveProperty('disabled', false)
    })
  })
  it('reproduz cada voz e trecho no tempo original e informa erro de reprodução', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const { container } = await montar(); enviar()
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Ouvir esta voz' })[1]!)
    expect(container.querySelector('audio')!.currentTime).toBe(1.1)
    fireEvent.change(screen.getByRole('combobox', { name: /^Voz 2$/ }), { target: { value: 'paciente' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir trecho aos 1.1s' }))
    expect(play).toHaveBeenCalledTimes(2)
    play.mockRejectedValueOnce(new Error('autoplay bloqueado'))
    fireEvent.click(screen.getByText('Corrigir texto e voz por palavra'))
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir palavra aos 2.1s' }))
    await screen.findByText('Não foi possível reproduzir o áudio.')
    fireEvent.change(screen.getByRole('combobox', { name: /^Voz 2$/ }), { target: { value: '' } })
    expect(screen.getByText('Paciente fala')).toBeTruthy()
  })
  it('não inicia uma captura depois de revogar consentimento durante a permissão do microfone', async () => {
    let liberar!: (stream: unknown) => void
    getUserMedia.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, gravacao: 'revogado' } }
    view.rerender(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>)
    await act(async () => liberar({ getTracks: () => [{ stop: parar }] }))
    expect(parar).toHaveBeenCalledOnce()
    expect(gravadores).toHaveLength(0)
  })
  it('ignora falha tardia do serviço depois de cancelar e informa uma rejeição sem Error', async () => {
    let rejeitar!: (reason: unknown) => void
    transcrever.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
    const view = await montar(); enviar()
    await waitFor(() => expect(transcrever).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => rejeitar(new Error('erro tardio')))
    transcrever.mockRejectedValueOnce('falha')
    await montar(); enviar()
    await screen.findByText('Não foi possível processar o áudio.')
    fireEvent.change(screen.getByLabelText('Ou carregar áudio'), { target: { files: [] } })
    expect(transcrever).toHaveBeenCalledTimes(2)
  })
  it('descarta uma transcrição antiga que termina depois de uma consulta nova', async () => {
    let liberar!: (palavras: Awaited<ReturnType<typeof transcreverLocal>>) => void
    transcrever.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    await montar(); enviar()
    await waitFor(() => expect(transcrever).toHaveBeenCalledOnce())
    enviar()
    await waitFor(() => expect(transcrever).toHaveBeenCalledTimes(2))
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    await act(async () => liberar([{ texto: 'resposta antiga', inicioMs: 0, fimMs: 1000, locutor: 'speaker_3' }]))
    expect(screen.queryByLabelText('Texto aos 0.0s')?.getAttribute('value')).not.toBe('resposta antiga')
    expect(screen.getByLabelText('Texto aos 0.0s').getAttribute('value')).toBe('Profissional fala')
  })
  it('não analisa o arquivo ao encerrar a captura se o consentimento foi revogado', async () => {
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, gravacao: 'revogado' } }
    view.rerender(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>)
    await waitFor(() => expect(parar).toHaveBeenCalled())
    await act(async () => {})
    expect(transcrever).not.toHaveBeenCalled()
  })
  it('no arquivo carregado o gateway já diz quem fala; corrigir uma voz tira o papel da outra', async () => {
    await montar(); enviar()
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    expect(transcrever).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), [1, 0])
    expect(abrirPerfil).toHaveBeenCalledWith('', 'conta', 'token', props.kek, expect.any(AbortSignal))
    expect((screen.getByRole('combobox', { name: /Voz 1/ }) as HTMLSelectElement).value).toBe('voce')
    expect((screen.getByRole('combobox', { name: /Voz 2/ }) as HTMLSelectElement).value).toBe('paciente')
    expect(screen.getByText('Voz sem identificação')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: /Voz 2/ }), { target: { value: 'voce' } })
    expect((screen.getByRole('combobox', { name: /Voz 1/ }) as HTMLSelectElement).value).toBe('')
  })
  it('não transcreve o arquivo sem saber quem fala: voz não cadastrada ou perfil que não abre', async () => {
    await montar()
    abrirPerfil.mockResolvedValueOnce(null)
    enviar()
    await screen.findByText('Cadastre sua voz antes de transcrever: é preciso saber quem está falando.')
    expect(transcrever).not.toHaveBeenCalled()
    abrirPerfil.mockRejectedValueOnce(new Error('Não foi possível abrir o perfil de voz.'))
    enviar()
    await screen.findByText('Não foi possível abrir o perfil de voz.')
    expect(transcrever).not.toHaveBeenCalled()
  })
  it('mantém áudio temporário sem chamar IA quando só a gravação foi consentida', async () => {
    paciente.consentimentos.analiseIa = 'pendente'
    await montar(); enviar()
    await screen.findByText('O áudio é temporário nesta sessão. Autorize a análise por IA para transcrever.')
    expect(transcrever).not.toHaveBeenCalled()
  })
  it('corrige texto e atribuição de palavras e exige nova revisão após editar', async () => {
    await montar(); enviar()
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    const confirmar = screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.' }) as HTMLInputElement
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Voz aos 2.1s'), { target: { value: 'paciente' } })
    expect(confirmar.disabled).toBe(false)
    fireEvent.click(confirmar)
    expect(screen.getByText('Transcrição revisada.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Texto aos 1.1s'), { target: { value: 'Palavra corrigida' } })
    expect(screen.queryByText('Transcrição revisada.')).toBeNull()
    expect(screen.getByText('Palavra corrigida Voz sem identificação')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Voz aos 1.1s'), { target: { value: 'profissional' } })
    expect(screen.getByText('Profissional fala Palavra corrigida')).toBeTruthy()
    expect(screen.getByText('Voz sem identificação')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Texto aos 1.1s'), { target: { value: '  ' } })
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Voz aos 1.1s'), { target: { value: '' } })
    expect(confirmar.disabled).toBe(true)
  })
  it('bloqueia captura sem consentimento e rejeita arquivos acima do limite', async () => {
    paciente.consentimentos.gravacao = 'revogado'
    const view = await montar()
    expect((screen.getByRole('button', { name: 'Iniciar gravação' }) as HTMLButtonElement).disabled).toBe(true)
    expect(getUserMedia).not.toHaveBeenCalled()
    view.unmount(); paciente.consentimentos.gravacao = 'concedido'
    await montar(); enviar(65 * 1024 * 1024)
    expect(screen.getByText('O áudio deve ter até 64 MB.')).toBeTruthy()
    expect(transcrever).not.toHaveBeenCalled()
  })
  it('transcreve durante a captura e drena o serviço antes de liberar o áudio temporário', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
    await waitFor(() => expect(encerrarSessao).toHaveBeenCalledOnce())
    expect(aoVivo).toHaveBeenCalledOnce()
    expect(transcrever).not.toHaveBeenCalled()
    expect(parar).toHaveBeenCalled()
    expect(armazenamento).not.toHaveBeenCalled()
  })
  it('informa falha de microfone, do serviço e uma transcrição vazia', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('sem microfone'))
    await montar(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByText('Autorize a gravação e permita o microfone.')
    transcrever.mockRejectedValueOnce(new Error('serviço indisponível'))
    enviar(); await screen.findByText('serviço indisponível')
    transcrever.mockResolvedValueOnce([])
    enviar(); await screen.findByText('Nenhuma fala foi reconhecida.')
  })
  it('cancela trabalho em voo e elimina a transcrição ao revogar análise', async () => {
    const view = await montar(); enviar()
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    const sinal = transcrever.mock.calls[0]![1]
    paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, analiseIa: 'revogado' } }
    view.rerender(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>)
    expect(sinal.aborted).toBe(true)
    expect(screen.queryByRole('combobox')).toBeNull()
    view.unmount()
    expect(revogarUrl).toHaveBeenCalledWith('blob:audio-local')
  })
  it('nunca abre armazenamento persistente para processar o áudio e libera a reprodução ao sair', async () => {
    const view = await montar(); enviar()
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    expect(armazenamento).not.toHaveBeenCalled()
    view.unmount()
    expect(revogarUrl).toHaveBeenCalledWith('blob:audio-local')
  })
  it('encerra as trilhas quando MediaRecorder não pode iniciar', async () => {
    vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('indisponível') } })
    await montar(); fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByText('Não foi possível iniciar a gravação.')
    expect(parar).toHaveBeenCalledOnce()
  })
  it.each([new NodeBlob([], { type: 'audio/wav' }), new NodeBlob(['html'], { type: 'text/html' })])('recusa áudio vazio ou tipo inválido', async (arquivo) => {
    await montar()
    fireEvent.change(screen.getByLabelText('Ou carregar áudio'), { target: { files: [arquivo] } })
    await screen.findByText('Escolha um arquivo de áudio válido.')
    expect(transcrever).not.toHaveBeenCalled()
  })

  async function revisar() {
    enviar()
    await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
    fireEvent.change(screen.getByLabelText('Voz aos 2.1s'), { target: { value: 'paciente' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.' }))
  }

  it('salva só a transcrição cifrada e recupera correções sem alterar a revisão anterior nem precisar de áudio', async () => {
    const view = await montar(); await revisar()
    expect((screen.getByRole('button', { name: 'Iniciar gravação' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText(/Transcrição salva no prontuário/)
    const original = registro.entries[1]!.ciphertext.slice()
    const bytes = await openEntries(paciente.dek, registro.entries, paciente.id)
    const primeira = lerTranscricao(bytes[1]!, paciente.id)!
    expect(primeira).toMatchObject({ revisao: 0, autorId: 'conta', papeis: { profissional: 'voce', paciente: 'paciente' } })
    expect(new TextDecoder().decode(bytes[1])).not.toMatch(/audio|blob|webm|wav/i)
    expect(new TextDecoder().decode(original)).not.toContain('Paciente fala')
    expect(armazenamento).not.toHaveBeenCalled()
    view.unmount()
    paciente.transcricoes = [primeira]
    const outra = await montar(false, { transcricao: primeira })
    expect(screen.queryByRole('button', { name: 'Ouvir esta voz' })).toBeNull()
    expect(outra.container.querySelector('audio')).toBeNull()
    fireEvent.change(screen.getByLabelText('Texto aos 1.1s'), { target: { value: 'Paciente corrigiu' } })
    fireEvent.change(screen.getByLabelText('Voz aos 1.1s'), { target: { value: 'profissional' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText(/Transcrição salva no prontuário/)
    expect(registro.entries[1]!.ciphertext).toEqual(original)
    const revisoes = await openEntries(paciente.dek, registro.entries, paciente.id)
    const segunda = lerTranscricao(revisoes[2]!, paciente.id)!
    expect(segunda).toMatchObject({ id: 'atendimento', revisao: 1, palavras: [primeira.palavras[0], { texto: 'Paciente corrigiu', inicioMs: 1100, fimMs: 2000, locutor: 'profissional' }, primeira.palavras[2]] })
    expect(screen.getAllByText(/Profissional responsável: conta/)).toHaveLength(2)
  })

  it('mantém a transcrição depois de uma falha e reconhece uma escrita confirmada pelo servidor antes da queda da resposta', async () => {
    await montar(); await revisar()
    vi.mocked(patients.appendPatientEntry).mockImplementationOnce(async (_base, _account, _token, _patient, entrada) => {
      registro.entries.push({ ...entrada, entryId: 'resposta-perdida', createdAt: '2026-10-02T12:00:00Z' })
      throw new Error('Resposta perdida')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText('Resposta perdida')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText(/Transcrição salva no prontuário/)
    expect(patients.appendPatientEntry).toHaveBeenCalledOnce()
    expect(registro.entries).toHaveLength(2)
  })

  it.each(['leitura', 'escrita', 'rejeicao'])('preserva alterações quando falha %s e deixa descartar explicitamente', async (etapa) => {
    await montar(); await revisar()
    if (etapa === 'leitura') vi.mocked(patients.getPatientRecord).mockResolvedValueOnce({ ok: false, code: 'patients.not_found', params: {} })
    if (etapa === 'escrita') vi.mocked(patients.appendPatientEntry).mockResolvedValueOnce({ ok: false, code: 'patients.entry_sequence_conflict', params: {} })
    if (etapa === 'rejeicao') vi.mocked(patients.appendPatientEntry).mockRejectedValueOnce('falha')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Salvar transcrição' }) as HTMLButtonElement).disabled).toBe(false))
    expect(registro.entries).toHaveLength(1)
    expect(pendencias.mock.lastCall?.[0]).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    await waitFor(() => expect(pendencias.mock.lastCall?.[0]).toBe(false))
    expect(screen.queryByRole('button', { name: 'Salvar transcrição' })).toBeNull()
  })

  it('recusa uma correção baseada em revisão antiga e permite descartar sem sobrescrever outra revisão', async () => {
    const anterior: Transcricao = { id: 'atendimento', patientId: paciente.id, revisao: 0, autorId: 'conta', materialIds: ['m1'], registradaEm: '2026-10-02T12:00:00Z',
      palavras: [{ texto: 'Original', inicioMs: 0, fimMs: 1000, locutor: 'speaker_1' }], papeis: { speaker_1: 'paciente' } }
    paciente.transcricoes = [anterior]
    const concorrente = { ...anterior, revisao: 1, palavras: [{ ...anterior.palavras[0]!, texto: 'Outra correção' }] }
    registro.entries.push({ entryId: 'outra-revisao', sequence: 2, createdAt: anterior.registradaEm,
      ciphertext: await sealEntry(paciente.dek, paciente.id, 2, transcricaoParaEntrada(concorrente)) })
    await montar(false, { transcricao: anterior })
    fireEvent.change(screen.getByLabelText('Texto aos 0.0s'), { target: { value: 'Minha correção' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await screen.findByText('Outra revisão foi salva. Reabra a transcrição antes de corrigir.')
    expect(patients.appendPatientEntry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect((screen.getByLabelText('Texto aos 0.0s') as HTMLInputElement).value).toBe('Outra correção')
  })

  it('avisa antes de fechar a página enquanto a transcrição ainda não foi salva', async () => {
    await montar(); await revisar()
    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    const outro = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(outro)
    expect(outro.defaultPrevented).toBe(false)
  })

  it('ignora chunks vazios e encerra captura no limite preservando apenas o áudio temporário já recebido', async () => {
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    const gravador = gravadores[0]!
    gravador.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new NodeBlob([]) }))
    gravador.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new NodeBlob(['prévia']) }))
    const excesso = new NodeBlob(['excesso'])
    Object.defineProperty(excesso, 'size', { value: 65 * 1024 * 1024 })
    gravador.dispatchEvent(Object.assign(new Event('dataavailable'), { data: excesso }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('A captura atingiu 64 MB e foi encerrada.')
    await waitFor(() => expect(encerrarSessao).toHaveBeenCalledOnce())
    await waitFor(() => expect(criarUrl).toHaveBeenCalled())
    expect(await criarUrl.mock.calls[0]![0].text()).toBe('prévia')
    expect(armazenamento).not.toHaveBeenCalled()
    expect(parar).toHaveBeenCalled()
  })

  it('libera as trilhas mesmo quando o gravador já está inativo ao desmontar', async () => {
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    gravadores[0]!.state = 'inactive'
    view.unmount()
    expect(parar).toHaveBeenCalledOnce()
  })
  it('exibe fala ao vivo, mantém o encerramento habilitado e permite pausar sem salvar áudio', async () => {
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    const atualizar = aoVivo.mock.calls[0]![2]
    const falhar = aoVivo.mock.calls[0]![3]
    const palavras = [
      { texto: 'Eu escuto.', inicioMs: 0, fimMs: 1000, locutor: 'speaker_1' },
      { texto: 'Tenho medo.', inicioMs: 1100, fimMs: 2000, locutor: 'speaker_2' },
      { texto: 'Incerto.', inicioMs: 2100, fimMs: 2200, locutor: null },
    ]
    await act(async () => atualizar({ palavras, finais: 0, estavelAteMs: 2300 }))
    fireEvent.change(screen.getByRole('combobox', { name: /^Voz 1$/ }), { target: { value: 'voce' } })
    fireEvent.change(screen.getByRole('combobox', { name: /^Voz 2$/ }), { target: { value: 'paciente' } })
    await act(async () => atualizar({ palavras, finais: 0, estavelAteMs: 2300 }))
    expect(screen.getByText('Tenho medo.', { exact: false })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Encerrar gravação' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByLabelText('Texto aos 1.1s') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Salvar transcrição' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pausar sessão' }))
    expect(pausarSessao).toHaveBeenLastCalledWith(true)
    expect(screen.getByText('Microfone pausado.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retomar sessão' }))
    expect(pausarSessao).toHaveBeenLastCalledWith(false)
    await act(async () => falhar(new Error('Falha de conexão')))
    await screen.findByText('Falha de conexão')
    await act(async () => falhar(new Error('segundo erro')))
    expect(armazenamento).not.toHaveBeenCalled()
    view.unmount()
    await act(async () => { atualizar({ palavras, finais: 0, estavelAteMs: 3000 }); falhar(new Error('tardio')) })
  })
  it('grava somente em memória quando a análise não foi consentida', async () => {
    paciente.consentimentos.analiseIa = 'pendente'
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
    await screen.findByText('O áudio é temporário nesta sessão. Autorize a análise por IA para transcrever.')
    expect(aoVivo).not.toHaveBeenCalled()
    expect(transcrever).not.toHaveBeenCalled()
    expect(armazenamento).not.toHaveBeenCalled()
  })
  it.each(['sair', 'revogar'])('não processa captura sem análise consentida depois de %s', async (modo) => {
    paciente.consentimentos.analiseIa = 'pendente'
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await screen.findByRole('button', { name: 'Encerrar gravação' })
    if (modo === 'sair') view.unmount()
    else {
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, gravacao: 'revogado' } }
      view.rerender(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>)
    }
    expect(criarUrl).not.toHaveBeenCalled()
  })
  it.each(['cancelar', 'sair'])('ignora eventos ao %s durante a abertura da conexão ao vivo', async (modo) => {
    let liberar!: (sessao: Awaited<ReturnType<typeof transcreverAoVivo>>) => void
    aoVivo.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    await waitFor(() => expect(aoVivo).toHaveBeenCalledOnce())
    if (modo === 'sair') view.unmount()
    else {
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, analiseIa: 'revogado' } }
      view.rerender(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>)
    }
    await act(async () => {
      aoVivo.mock.calls[0]![2]({ palavras: [], finais: 0, estavelAteMs: 0 })
      aoVivo.mock.calls[0]![3](new Error('tardio'))
      liberar({ encerrar: encerrarSessao, pausar: pausarSessao })
    })
    expect(gravadores[0]!.state).toBe('inactive')
    expect(parar).toHaveBeenCalledOnce()
  })
  it('não aplica conclusão de transcrição depois de sair durante a cauda', async () => {
    let liberar!: () => void
    encerrarSessao.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    const view = await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
    await waitFor(() => expect(encerrarSessao).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => liberar())
    expect(criarUrl).not.toHaveBeenCalled()
  })
  it('libera as trilhas e mantém a mensagem de falha quando a cauda é rejeitada', async () => {
    encerrarSessao.mockRejectedValueOnce(new Error('cauda'))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar gravação' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
    await waitFor(() => expect(parar).toHaveBeenCalled())
    expect(criarUrl).not.toHaveBeenCalled()
  })

  it('não inicia uma escrita depois de sair enquanto a leitura do prontuário estava pendente', async () => {
    const view = await montar(); await revisar()
    let resolver!: (valor: patients.GetPatientRecordResult) => void
    vi.mocked(patients.getPatientRecord).mockImplementationOnce(() => new Promise((resolve) => { resolver = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await waitFor(() => expect(patients.getPatientRecord).toHaveBeenCalled())
    view.unmount()
    await act(async () => { resolver(registro); await new Promise((feito) => setTimeout(feito, 100)) })
    expect(patients.appendPatientEntry).not.toHaveBeenCalled()
  })

  it.each(['sucesso', 'falha'])('não aplica resposta tardia de escrita após desmontar: %s', async (resultado) => {
    const aoSalvar = vi.fn()
    const view = await montar(false, { onSaved: aoSalvar }); await revisar()
    let resolver!: (valor: patients.AppendPatientEntryResult) => void
    let rejeitar!: (erro: Error) => void
    vi.mocked(patients.appendPatientEntry).mockImplementationOnce(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    await waitFor(() => expect(patients.appendPatientEntry).toHaveBeenCalled())
    view.unmount()
    await act(async () => {
      if (resultado === 'sucesso') resolver({ ok: true, sequence: 2, entryId: 'salva', createdAt: '2026-10-02T12:00:00Z' })
      else rejeitar(new Error('Resposta tardia'))
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(aoSalvar).not.toHaveBeenCalled()
    expect(revogarUrl).toHaveBeenCalledWith('blob:audio-local')
  })

  describe('estado, textos e bloqueios', () => {
    const voz = (n: number) => screen.getByRole('combobox', { name: new RegExp(`^Voz ${n}$`) }) as HTMLSelectElement
    const iniciar = () => screen.getByRole('button', { name: 'Iniciar gravação' }) as HTMLButtonElement
    const arquivo = () => screen.getByLabelText('Ou carregar áudio') as HTMLInputElement
    const conferi = () => screen.getByRole('checkbox', { name: 'Conferi o texto e quem falou cada trecho ouvindo o áudio.' }) as HTMLInputElement

    it('abre com a seção nomeada, o texto do perfil de voz, o acervo em preparo e nada bloqueado sem motivo', async () => {
      const preparo = deferred<Awaited<ReturnType<typeof prepareAuthorizedMaterials>>>()
      vi.mocked(prepareAuthorizedMaterials).mockReturnValueOnce(preparo.promise)
      await montar()
      expect(screen.getByRole('region', { name: 'Gravação e transcrição' })).toBeTruthy()
      expect(screen.getByText('Seu perfil de voz identifica o profissional. Confira as falas incertas antes de usar a transcrição.')).toBeTruthy()
      expect(screen.getByText('Preparando seu acervo autorizado para o copiloto local...')).toBeTruthy()
      expect(screen.queryByText('O consentimento de gravação é necessário.')).toBeNull()
      expect(screen.queryByText('Transcrevendo e separando as vozes...')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('combobox')).toBeNull()
      expect(screen.queryByText(/Revisões e correções/)).toBeNull()
      expect(iniciar().disabled).toBe(false)
      expect(arquivo().disabled).toBe(false)
      await act(async () => preparo.resolve({ materialIds: [], pending: 0, materials: [] }))
      expect(screen.queryByText('Preparando seu acervo autorizado para o copiloto local...')).toBeNull()
    })

    it('com o preparo do acervo falho não diz que ainda prepara; sem consentimento de análise nem prepara', async () => {
      vi.mocked(prepareAuthorizedMaterials).mockRejectedValueOnce(new Error('offline'))
      const view = await montar()
      await screen.findByText('Há materiais autorizados que não estão prontos nesta máquina. Verifique seu acervo pessoal.')
      expect(screen.queryByText('Preparando seu acervo autorizado para o copiloto local...')).toBeNull()
      view.unmount()
      vi.mocked(prepareAuthorizedMaterials).mockClear()
      paciente.consentimentos.analiseIa = 'pendente'
      await montar()
      expect(prepareAuthorizedMaterials).not.toHaveBeenCalled()
      expect(screen.queryByText('Preparando seu acervo autorizado para o copiloto local...')).toBeNull()
      expect(screen.queryByText(/não estão prontos nesta máquina/)).toBeNull()
    })

    it('sem consentimento de gravação avisa e trava gravar e carregar áudio', async () => {
      paciente.consentimentos.gravacao = 'revogado'
      await montar()
      expect(screen.getByText('O consentimento de gravação é necessário.')).toBeTruthy()
      expect(iniciar().disabled).toBe(true)
      expect(arquivo().disabled).toBe(true)
    })

    it('enquanto analisa mostra o andamento e trava as entradas; ao terminar libera a mensagem e mantém travado até salvar ou descartar', async () => {
      const analise = deferred<Awaited<ReturnType<typeof transcreverLocal>>>()
      transcrever.mockReturnValueOnce(analise.promise)
      await montar(); enviar()
      expect((await screen.findByText('Transcrevendo e separando as vozes...')).getAttribute('role')).toBe('status')
      expect(screen.getByText('Preparando o áudio para o Nemotron...')).toBeTruthy()
      expect(iniciar().disabled).toBe(true)
      expect(arquivo().disabled).toBe(true)
      await act(async () => analise.resolve([{ texto: 'Fala', inicioMs: 0, fimMs: 500, locutor: 'profissional' }]))
      expect(screen.queryByText('Transcrevendo e separando as vozes...')).toBeNull()
      expect(screen.getByText('Transcrição concluída. Confirme os papéis das vozes.')).toBeTruthy()
      expect(iniciar().disabled).toBe(true)
      expect(arquivo().disabled).toBe(true)
      expect(screen.getByRole('button', { name: 'Descartar alterações' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Descartar alterações' }))
      expect(iniciar().disabled).toBe(false)
      expect(arquivo().disabled).toBe(false)
      expect(screen.queryByRole('combobox')).toBeNull()
    })

    it('trocar o papel de uma voz tira o mesmo papel de outra, limpar não mexe nas demais e tudo exige nova conferência', async () => {
      await montar(); await revisar()
      expect(screen.getByText('Transcrição revisada.')).toBeTruthy()
      expect([voz(1).value, voz(2).value]).toEqual(['voce', 'paciente'])
      fireEvent.change(voz(1), { target: { value: 'paciente' } })
      expect([voz(1).value, voz(2).value]).toEqual(['paciente', ''])
      expect(screen.queryByText('Transcrição revisada.')).toBeNull()
      expect(conferi().disabled).toBe(true)
      fireEvent.change(voz(2), { target: { value: 'voce' } })
      expect([voz(1).value, voz(2).value]).toEqual(['paciente', 'voce'])
      expect(conferi().disabled).toBe(false)
      fireEvent.change(voz(1), { target: { value: '' } })
      expect([voz(1).value, voz(2).value]).toEqual(['', 'voce'])
      expect(conferi().disabled).toBe(true)
    })

    it('mostra a gravação ao vivo com o texto certo, o aviso de memória e a pausa', async () => {
      await montar()
      fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      expect(screen.getByText('Transcrição ao vivo. Seu perfil de voz identifica quem está falando.')).toBeTruthy()
      expect(screen.getByText('O áudio permanece somente em memória durante a sessão.')).toBeTruthy()
      expect(arquivo().disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Pausar sessão' }))
      expect(pausarSessao).toHaveBeenLastCalledWith(true)
      expect(screen.getByText('Microfone pausado.')).toBeTruthy()
      expect(screen.queryByText('O áudio permanece somente em memória durante a sessão.')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Retomar sessão' }))
      expect(pausarSessao).toHaveBeenLastCalledWith(false)
    })

    it('lista cada revisão com número, data, responsável e as falas por papel', async () => {
      const revisao: Transcricao = { id: 'atendimento', patientId: 'paciente', revisao: 2, autorId: 'dra-ana', registradaEm: '2026-10-02T12:00:00Z',
        palavras: [{ texto: 'Bom', inicioMs: 0, fimMs: 100, locutor: 'A' }, { texto: 'dia.', inicioMs: 100, fimMs: 200, locutor: 'A' }, { texto: 'Oi', inicioMs: 300, fimMs: 400, locutor: 'B' }],
        papeis: { A: 'voce', B: 'paciente' } }
      paciente.transcricoes = [revisao]
      await montar(false, { transcricao: revisao })
      const artigo = screen.getByText(/Revisões e correções/).closest('details')!.querySelector('article')!
      const data = i18n.date(revisao.registradaEm, { dateStyle: 'short', timeStyle: 'medium' })
      const paragrafos = [...artigo.querySelectorAll('p')].map((p) => p.textContent)
      expect(paragrafos).toEqual([`Revisão 3 — ${data} — Profissional responsável: dra-ana`, 'Profissional: Bom dia.', 'Paciente: Oi'])
      expect(screen.getByRole('textbox', { name: 'Texto aos 0.0s' })).toBeTruthy()
    })

    it('mostra o motivo de cada falha ao salvar e ignora o que é de outras sessões no prontuário', async () => {
      const outra: Transcricao = { id: 'outra-sessao', patientId: 'paciente', revisao: 0, autorId: 'conta', materialIds: ['m1'], registradaEm: '2026-10-02T12:00:00Z',
        palavras: [{ texto: 'Outra', inicioMs: 0, fimMs: 100, locutor: 'A' }], papeis: { A: 'paciente' } }
      registro.entries.push({ entryId: 'outra', sequence: 2, createdAt: outra.registradaEm, ciphertext: await sealEntry(paciente.dek, paciente.id, 2, transcricaoParaEntrada(outra)) })
      await montar(); await revisar()
      vi.mocked(patients.getPatientRecord).mockResolvedValueOnce({ ok: false, code: 'patients.not_found', params: {} })
      fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
      await screen.findByText('Prontuário não encontrado.')
      vi.mocked(patients.appendPatientEntry).mockRejectedValueOnce('falha')
      fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
      await screen.findByText('Não foi possível salvar a transcrição.')
      fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
      await screen.findByText(/Transcrição salva no prontuário/)
      expect(patients.getPatientRecord).toHaveBeenCalledWith('', 'conta', 'token', 'paciente')
      const salvas = (await openEntries(paciente.dek, registro.entries, paciente.id)).map((bytes) => lerTranscricao(bytes, paciente.id)).filter((lida) => lida !== null)
      expect(salvas.map((lida) => [lida.id, lida.revisao])).toEqual([['outra-sessao', 0], ['atendimento', 0]])
    })

    it('o consentimento revogado cancela só o que depende dele e não para a gravação por outro motivo', async () => {
      const view = await montar()
      fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      const sinal = abrirPerfil.mock.lastCall![4]
      expect(sinal.aborted).toBe(false)
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, analiseIa: 'revogado' } }
      view.rerender(<I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} /></I18nProvider>)
      expect(sinal.aborted).toBe(true)
      expect(gravadores[0]!.state).toBe('inactive')
    })
  })

  describe('fluxos e limites', () => {
    class GravadorEstrito extends Gravador {
      override stop() { if (this.state === 'inactive') throw new Error('InvalidStateError'); this.state = 'inactive' }
    }
    const fonte = { trecho_id: 'fonte', titulo: 'Livro', autor: 'Autor', pagina: 4, paragrafo: 2, citacao_literal: 'Citação literal', fenomeno_na_fala: 'Medo', fenomeno_no_trecho: 'Medo', probabilidade: 0.995, nivel: 'forte' as const }
    const semFonte = async () => ({ cartoes: [], clarificar: false, alerta_risco: false, completo: true, juiz: 'v7' })
    const comFonte = () => vi.mocked(consultarInsight).mockImplementation(async () => ({ cartoes: [fonte], clarificar: false, alerta_risco: false, completo: true, juiz: 'v7' }))
    const salva = (revisao = 0): Transcricao => ({ id: 'atendimento', patientId: 'paciente', revisao, autorId: 'conta', materialIds: ['m1'], registradaEm: '2026-10-02T12:00:00Z',
      palavras: [{ texto: 'Tenho medo.', inicioMs: 100, fimMs: 900, locutor: 'A' }], papeis: { A: 'paciente' } })
    const voz = (n: number) => screen.getByRole('combobox', { name: new RegExp(`^Voz ${n}$`) }) as HTMLSelectElement
    const iniciar = () => screen.getByRole('button', { name: 'Iniciar gravação' }) as HTMLButtonElement
    const arquivo = () => screen.getByLabelText('Ou carregar áudio') as HTMLInputElement
    const conferi = (rotulo = 'Conferi o texto e quem falou cada trecho ouvindo o áudio.') => screen.getByRole('checkbox', { name: rotulo }) as HTMLInputElement
    const botao = (nome: string) => screen.getByRole('button', { name: nome }) as HTMLButtonElement
    const nova = (extras: Partial<SessionReviewProps> = {}) => <I18nProvider i18n={i18n}><SessionReview {...props} paciente={paciente} {...extras} /></I18nProvider>
    const revogar = (view: { rerender(ui: React.ReactNode): void }, campo: 'analiseIa' | 'gravacao', extras: Partial<SessionReviewProps> = {}) => {
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, [campo]: 'revogado' } }
      view.rerender(nova(extras))
    }
    const aguardarTranscricao = 'Transcrevendo e separando as vozes...'
    const grande = (tamanho: number) => Object.defineProperty(new NodeBlob(['x']), 'size', { value: tamanho })
    const dados = (gravador: Gravador, bloco: NodeBlob) => gravador.dispatchEvent(Object.assign(new Event('dataavailable'), { data: bloco }))
    afterEach(() => { vi.mocked(consultarInsight).mockImplementation(semFonte); localStorage.clear() })

    it('sem nada a mostrar não há status, vozes, histórico nem áudio a liberar', async () => {
      const view = await montar(); await act(async () => {})
      expect(screen.queryAllByRole('status')).toHaveLength(0)
      expect(screen.queryByText('Identificar vozes')).toBeNull()
      expect(screen.queryByText(/Revisões e correções/)).toBeNull()
      view.unmount()
      expect(revogarUrl).not.toHaveBeenCalled()
    })

    it('a revisão 0 já é uma revisão salva: trava nova gravação, mantém Salvar desligado e libera a edição', async () => {
      paciente.transcricoes = [salva(0)]
      await montar(false, { transcricao: salva(0) })
      expect([iniciar().disabled, arquivo().disabled, botao('Salvar transcrição').disabled]).toEqual([true, true, true])
      expect(screen.queryByText('Escute o áudio para corrigir palavras e trechos atribuídos à voz errada.')).toBeNull()
      expect((screen.getByLabelText('Texto aos 0.1s') as HTMLInputElement).disabled).toBe(false)
      expect((screen.getByLabelText('Voz aos 0.1s') as HTMLSelectElement).disabled).toBe(false)
      expect(voz(1).disabled).toBe(false)
      expect(conferi('Conferi o texto e quem falou cada trecho.').checked).toBe(true)
    })

    it('o voto vai para o cofre da conta e acompanha a troca de conta', async () => {
      comFonte(); paciente.transcricoes = [salva(0)]
      const view = await montar(false, { transcricao: salva(0) })
      fireEvent.click((await screen.findAllByRole('button', { name: 'Útil' }))[0]!)
      fireEvent.click(await screen.findByRole('button', { name: 'Só neste aparelho' }))
      await waitFor(async () => expect(await lerVotos(props.kek, 'conta')).toHaveLength(1))
      view.rerender(nova({ transcricao: salva(0), accountId: 'outra' }))
      fireEvent.click((await screen.findAllByRole('button', { name: 'Não útil' }))[0]!)
      await waitFor(async () => expect(await lerVotos(props.kek, 'outra')).toHaveLength(1))
      expect(await lerVotos(props.kek, 'conta')).toHaveLength(1)
    })

    it('analisar ou gravar já é pendência, e uma análise vazia termina sem pendência', async () => {
      const analise = deferred<Awaited<ReturnType<typeof transcreverLocal>>>()
      transcrever.mockReturnValueOnce(analise.promise)
      await montar(); enviar()
      await screen.findByText(aguardarTranscricao)
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(true))
      await act(async () => analise.resolve([]))
      await screen.findByText('Nenhuma fala foi reconhecida.')
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(false))
      fireEvent.click(iniciar()); await screen.findByRole('button', { name: 'Encerrar gravação' })
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(true))
    })

    it('sem perfil de voz a análise do arquivo termina sem pendência', async () => {
      await montar()
      abrirPerfil.mockResolvedValueOnce(null)
      enviar()
      await screen.findByText('Cadastre sua voz antes de transcrever: é preciso saber quem está falando.')
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(false))
    })

    it.each(['resolve', 'rejeita'])('o preparo do acervo que termina (%s) depois de revogar a análise é descartado e reautorizar prepara de novo', async (modo) => {
      const preparo = deferred<Awaited<ReturnType<typeof prepareAuthorizedMaterials>>>()
      vi.mocked(prepareAuthorizedMaterials).mockReturnValueOnce(preparo.promise)
      const view = await montar()
      revogar(view, 'analiseIa')
      await act(async () => { if (modo === 'resolve') preparo.resolve({ materialIds: ['m'], pending: 2, materials: [{ materialId: 'm', title: 'Obra', ready: true }] }); else preparo.reject(new Error('tarde')) })
      expect(screen.queryByText('Há materiais autorizados que não estão prontos nesta máquina. Verifique seu acervo pessoal.')).toBeNull()
      paciente = { ...paciente, consentimentos: { ...paciente.consentimentos, analiseIa: 'concedido' } }
      view.rerender(nova())
      await waitFor(() => expect(prepareAuthorizedMaterials).toHaveBeenCalledTimes(2))
    })

    it('só consulta os insights com o acervo pronto e entrega a eles o acervo autorizado', async () => {
      comFonte(); paciente.transcricoes = [salva(0)]
      const preparo = deferred<Awaited<ReturnType<typeof prepareAuthorizedMaterials>>>()
      vi.mocked(prepareAuthorizedMaterials).mockReturnValueOnce(preparo.promise)
      await montar(false, { transcricao: salva(0) })
      await new Promise((feito) => setTimeout(feito, 700))
      expect(consultarInsight).not.toHaveBeenCalled()
      await act(async () => preparo.resolve({ materialIds: ['m1'], pending: 0, materials: [{ materialId: 'm1', title: 'Obra de teste', ready: true }] }))
      await waitFor(() => expect(consultarInsight).toHaveBeenCalled())
      expect(vi.mocked(consultarInsight).mock.lastCall![4]).toEqual({ accountId: 'conta', accessToken: 'token', materialIds: ['m1'] })
    })

    it('a referência para a nota só existe com a ação, a revisão salva e nada pendente', async () => {
      comFonte(); paciente.transcricoes = [salva(0)]
      const aoPropor = vi.fn()
      const view = await montar(false, { transcricao: salva(0), onPropostaReferencia: aoPropor })
      fireEvent.click(await screen.findByRole('button', { name: 'Usar na nota' }))
      expect(aoPropor).toHaveBeenCalledOnce()
      fireEvent.change(screen.getByLabelText('Texto aos 0.1s'), { target: { value: 'Mudou.' } })
      await waitFor(() => expect(botao('Usar na nota').disabled).toBe(true), { timeout: 3000 })
      view.unmount()
      await montar(false, { transcricao: salva(0) })
      await screen.findByText('Salve a revisão da transcrição para usar uma referência na nota.')
      expect(botao('Usar na nota').disabled).toBe(true)
    })

    it('avisa o fechamento da página com o valor de retorno vazio', async () => {
      await montar(); await revisar()
      const evento = new Event('beforeunload', { cancelable: true })
      const definir = vi.fn()
      Object.defineProperty(evento, 'returnValue', { set: definir, configurable: true })
      window.dispatchEvent(evento)
      expect(definir).toHaveBeenCalledWith('')
    })

    it('desmontar com gravação em curso para o gravador', async () => {
      const view = await montar(); fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      view.unmount()
      expect(gravadores[0]!.state).toBe('inactive')
    })

    it('um gravador que já parou não é parado de novo ao revogar a gravação nem ao desmontar', async () => {
      vi.stubGlobal('MediaRecorder', GravadorEstrito)
      const view = await montar(); fireEvent.click(iniciar())
      fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
      expect(gravadores[0]!.state).toBe('inactive')
      revogar(view, 'gravacao')
      view.unmount()
    })

    it('revogar a gravação cancela a abertura do perfil, e revogar a análise só o que depende dela', async () => {
      const view = await montar(); fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      const sinal = abrirPerfil.mock.lastCall![4]
      revogar(view, 'gravacao')
      expect(sinal.aborted).toBe(true)
    })

    it('um novo encerramento preparado pela página substitui o anterior', async () => {
      const antigo = vi.fn(), novo = vi.fn()
      const view = await montar(false, { prepararEncerramento: antigo })
      view.rerender(nova({ prepararEncerramento: novo }))
      expect([antigo, novo].map((f) => f.mock.calls.length)).toEqual([1, 1])
    })

    it('o microfone pedindo permissão é trabalho em andamento, e a recusa devolve o controle', async () => {
      const permissao = deferred<unknown>()
      getUserMedia.mockReturnValueOnce(permissao.promise)
      await montar(); fireEvent.click(iniciar())
      expect(screen.getByText(aguardarTranscricao)).toBeTruthy()
      await act(async () => permissao.reject(new Error('negado')))
      await screen.findByText('Autorize a gravação e permita o microfone.')
      expect(screen.queryByText(aguardarTranscricao)).toBeNull()
      expect(iniciar().disabled).toBe(false)
    })

    it.each([[[1, 0]], [null]])('perfil que chega (%j) depois de revogar a análise não inicia a captura nem acusa erro', async (resposta) => {
      const perfil = deferred<number[] | null>()
      abrirPerfil.mockReturnValueOnce(perfil.promise)
      const view = await montar(); fireEvent.click(iniciar())
      await waitFor(() => expect(abrirPerfil).toHaveBeenCalledOnce())
      revogar(view, 'analiseIa')
      await act(async () => perfil.resolve(resposta))
      expect(aoVivo).not.toHaveBeenCalled()
      expect(parar).toHaveBeenCalledOnce()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('a captura ao vivo marca alteração, mostra só vozes identificadas, trava a edição e ignora o tardio depois de revogar', async () => {
      const view = await montar(); fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      const [, , atualizar, falhar] = aoVivo.mock.lastCall!
      act(() => atualizar({ palavras: [{ texto: 'Oi', inicioMs: 0, fimMs: 100, locutor: 'profissional' }, { texto: 'Hmm', inicioMs: 200, fimMs: 300, locutor: null }], finais: 1, estavelAteMs: 100 }))
      expect(botao('Descartar alterações').disabled).toBe(true)
      expect(screen.queryByRole('combobox', { name: /^Voz 2$/ })).toBeNull()
      expect(conferi('Conferi o texto e quem falou cada trecho.').checked).toBe(false)
      expect((screen.getByLabelText('Texto aos 0.0s') as HTMLInputElement).disabled).toBe(true)
      expect((screen.getByLabelText('Voz aos 0.0s') as HTMLSelectElement).disabled).toBe(true)
      expect(voz(1).disabled).toBe(false)
      revogar(view, 'analiseIa')
      await act(async () => { atualizar({ palavras: [{ texto: 'Tardia', inicioMs: 0, fimMs: 100, locutor: 'profissional' }], finais: 1, estavelAteMs: 100 }); falhar(new Error('falha tardia')) })
      expect(screen.queryByText('Tardia')).toBeNull()
      expect(screen.queryByText('falha tardia')).toBeNull()
      expect(gravadores[0]!.state).toBe('inactive')
    })

    it('uma fala vazia ao vivo não deixa alteração pendente depois de parar', async () => {
      await montar(); fireEvent.click(iniciar())
      fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
      act(() => aoVivo.mock.lastCall![2]({ palavras: [], finais: 0, estavelAteMs: 0 }))
      await waitFor(() => expect(encerrarSessao).toHaveBeenCalled())
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(false))
    })

    it('o erro do serviço ao vivo para a gravação uma única vez', async () => {
      vi.stubGlobal('MediaRecorder', GravadorEstrito)
      await montar(); fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      const falhar = aoVivo.mock.lastCall![3]
      act(() => falhar(new Error('serviço caiu')))
      expect(screen.getByRole('alert').textContent).toBe('serviço caiu')
      expect(gravadores[0]!.state).toBe('inactive')
      act(() => falhar(new Error('serviço caiu de novo')))
    })

    it('o limite da captura é exatamente 64 MB', async () => {
      await montar(); fireEvent.click(iniciar())
      await screen.findByRole('button', { name: 'Encerrar gravação' })
      const gravador = gravadores[0]!
      dados(gravador, grande(64 * 1024 * 1024))
      expect(gravador.state).toBe('recording')
      expect(screen.queryByText('A captura atingiu 64 MB e foi encerrada.')).toBeNull()
      dados(gravador, grande(1))
      await screen.findByText('A captura atingiu 64 MB e foi encerrada.')
      expect(gravador.state).toBe('inactive')
    })

    it('aceita arquivo de exatamente 64 MB', async () => {
      await montar(); enviar(64 * 1024 * 1024)
      await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
      expect(transcrever).toHaveBeenCalledOnce()
    })

    it('ao parar espera a cauda do serviço, devolve o áudio com o tipo certo e ignora um segundo stop', async () => {
      const cauda = deferred<void>()
      encerrarSessao.mockReturnValueOnce(cauda.promise)
      await montar(); fireEvent.click(iniciar())
      fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
      await waitFor(() => expect(encerrarSessao).toHaveBeenCalledOnce())
      expect(iniciar()).toBeTruthy()
      expect(screen.getByText(aguardarTranscricao)).toBeTruthy()
      await act(async () => cauda.resolve())
      expect(screen.queryByText(aguardarTranscricao)).toBeNull()
      expect(criarUrl.mock.lastCall![0].type).toBe('audio/webm')
      gravadores[0]!.dispatchEvent(new Event('stop'))
      await act(async () => { await new Promise((feito) => setTimeout(feito, 50)) })
      expect(transcrever).not.toHaveBeenCalled()
      expect(encerrarSessao).toHaveBeenCalledOnce()
    })

    it('sem análise consentida a gravação não tem pausa e, ao parar, só guarda o áudio temporário', async () => {
      paciente.consentimentos.analiseIa = 'pendente'
      await montar(); fireEvent.click(iniciar())
      fireEvent.click(await screen.findByRole('button', { name: 'Encerrar gravação' }))
      expect(screen.queryByRole('button', { name: 'Pausar sessão' })).toBeNull()
      await screen.findByText('O áudio é temporário nesta sessão. Autorize a análise por IA para transcrever.')
      expect(parar).toHaveBeenCalled()
    })

    it('depois do arquivo: só vozes identificadas, ajuda do áudio, campos livres e Salvar só depois da conferência', async () => {
      await montar(); enviar()
      await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
      expect(screen.queryByRole('combobox', { name: /^Voz 3$/ })).toBeNull()
      expect(screen.getByText('Escute o áudio para corrigir palavras e trechos atribuídos à voz errada.')).toBeTruthy()
      expect((screen.getByLabelText('Texto aos 1.1s') as HTMLInputElement).disabled).toBe(false)
      const palavra = screen.getByLabelText('Voz aos 0.0s') as HTMLSelectElement
      expect([palavra.value, palavra.disabled]).toEqual(['profissional', false])
      expect([...palavra.options].map((opcao) => opcao.textContent)).toEqual(['Não identificado', 'Voz 1', 'Voz 2'])
      expect(voz(1).disabled).toBe(false)
      fireEvent.change(screen.getByLabelText('Voz aos 2.1s'), { target: { value: 'paciente' } })
      expect(conferi().disabled).toBe(false)
      expect(botao('Salvar transcrição').disabled).toBe(true)
      fireEvent.click(conferi())
      expect(botao('Salvar transcrição').disabled).toBe(false)
    })

    it('descartar e enviar outro áudio não herda a conferência anterior', async () => {
      await montar(); await revisar()
      expect(conferi().checked).toBe(true)
      fireEvent.click(botao('Descartar alterações'))
      enviar()
      await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
      expect(conferi().checked).toBe(false)
    })

    it('uma análise cancelada não mostra o erro dela e uma antiga não libera a nova', async () => {
      const antiga = deferred<Awaited<ReturnType<typeof transcreverLocal>>>(), seguinte = deferred<Awaited<ReturnType<typeof transcreverLocal>>>()
      transcrever.mockReturnValueOnce(antiga.promise).mockReturnValueOnce(seguinte.promise)
      await montar(); enviar()
      await waitFor(() => expect(transcrever).toHaveBeenCalledTimes(1))
      enviar()
      await waitFor(() => expect(transcrever).toHaveBeenCalledTimes(2))
      await act(async () => antiga.reject(new Error('erro da antiga')))
      expect(screen.queryByText('erro da antiga')).toBeNull()
      expect(screen.getByText(aguardarTranscricao)).toBeTruthy()
      await act(async () => seguinte.resolve([{ texto: 'Nova', inicioMs: 0, fimMs: 100, locutor: 'profissional' }]))
      expect(screen.queryByText(aguardarTranscricao)).toBeNull()
    })

    it('enquanto salva, tudo fica travado, e ao terminar não sobra alteração pendente', async () => {
      await montar(); await revisar()
      const escrita = deferred<patients.AppendPatientEntryResult>()
      vi.mocked(patients.appendPatientEntry).mockReturnValueOnce(escrita.promise)
      fireEvent.click(botao('Salvar transcrição'))
      await screen.findByText(aguardarTranscricao)
      const travados = [botao('Salvar transcrição'), botao('Descartar alterações'), screen.getByLabelText('Texto aos 1.1s'), screen.getByLabelText('Voz aos 1.1s'), voz(1), conferi()]
      expect(travados.map((elemento) => (elemento as HTMLButtonElement).disabled)).toEqual([true, true, true, true, true, true])
      await act(async () => escrita.resolve({ ok: true, sequence: 2, entryId: 'e', createdAt: '2026-10-02T12:00:00Z' }))
      expect(screen.getByText(/Transcrição salva no prontuário/)).toBeTruthy()
      expect(screen.queryByText(aguardarTranscricao)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Descartar alterações' })).toBeNull()
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(false))
    })

    it('salva sem os papéis de vozes que ficaram sem palavras', async () => {
      await montar(); enviar()
      await screen.findByText('Transcrição concluída. Confirme os papéis das vozes.')
      fireEvent.change(screen.getByLabelText('Voz aos 1.1s'), { target: { value: 'profissional' } })
      fireEvent.change(screen.getByLabelText('Voz aos 2.1s'), { target: { value: 'profissional' } })
      fireEvent.change(voz(2), { target: { value: '' } })
      fireEvent.click(conferi())
      fireEvent.click(botao('Salvar transcrição'))
      await screen.findByText(/Transcrição salva no prontuário/)
      const abertas = await openEntries(paciente.dek, registro.entries, paciente.id)
      const salvaNoProntuario = abertas.map((bytes) => lerTranscricao(bytes, paciente.id)).find((entrada) => entrada !== null)
      expect(salvaNoProntuario?.papeis).toEqual({ profissional: 'voce' })
    })

    it('descartar volta à revisão salva: conferida, sem alteração e com o aviso de recuperação', async () => {
      paciente.transcricoes = [salva(0)]
      await montar(false, { transcricao: salva(0) })
      fireEvent.change(screen.getByLabelText('Texto aos 0.1s'), { target: { value: 'Mudou' } })
      fireEvent.click(conferi('Conferi o texto e quem falou cada trecho.'))
      vi.mocked(patients.getPatientRecord).mockResolvedValueOnce({ ok: false, code: 'patients.not_found', params: {} })
      fireEvent.click(botao('Salvar transcrição'))
      await screen.findByText('Prontuário não encontrado.')
      fireEvent.click(botao('Descartar alterações'))
      expect(screen.getByText('Transcrição recuperada do prontuário. O áudio não é armazenado.')).toBeTruthy()
      expect(conferi('Conferi o texto e quem falou cada trecho.').checked).toBe(true)
      expect(screen.queryByRole('button', { name: 'Descartar alterações' })).toBeNull()
      expect((screen.getByLabelText('Texto aos 0.1s') as HTMLInputElement).value).toBe('Tenho medo.')
      await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(false))
    })

    describe('chamada online', () => {
      const local = {} as MediaStream, remoto = {} as MediaStream
      const online = { local, remoto, ativa: true }
      const apresentar = (entrada: NonNullable<SessionReviewProps['online']> = online, extras: Partial<SessionReviewProps> = {}) => nova({ online: entrada, ...extras })
      const palavra = (texto: string, inicioMs: number, fimMs: number, locutor = 'online-paciente') => ({ texto, inicioMs, fimMs, locutor })
      const chamada = () => vi.mocked(transcreverOnline).mock.lastCall!
      const abertura = () => deferred<Awaited<ReturnType<typeof transcreverOnline>>>()

      it('conta o tempo de cada época desde o começo da primeira', async () => {
        let agora = 1000
        const relogio = vi.spyOn(performance, 'now').mockImplementation(() => agora)
        try {
          const view = render(apresentar())
          await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
          expect(chamada()[5]).toBe(0)
          agora = 1750
          view.rerender(apresentar({ ...online, remoto: {} as MediaStream }))
          await waitFor(() => expect(transcreverOnline).toHaveBeenCalledTimes(2))
          expect(chamada()[5]).toBe(750)
        } finally { relogio.mockRestore() }
      })

      it('ao reconectar desfaz a conferência anterior e mostra a abertura como trabalho em andamento', async () => {
        const view = render(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
        act(() => chamada()[3]({ palavras: [palavra('Estou', 200, 350), palavra('aqui.', 200, 450)], finais: 2, estavelAteMs: 500 }))
        view.rerender(apresentar({ ...online, ativa: false }))
        const caixa = () => conferi('Conferi o texto e quem falou cada trecho.')
        await waitFor(() => expect(caixa().disabled).toBe(false))
        fireEvent.click(caixa())
        expect(caixa().checked).toBe(true)
        const segunda = abertura()
        vi.mocked(transcreverOnline).mockReturnValueOnce(segunda.promise)
        view.rerender(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledTimes(2))
        expect(screen.getByText(aguardarTranscricao)).toBeTruthy()
        expect(caixa().checked).toBe(false)
        await act(async () => segunda.resolve({ encerrar: encerrarSessao, pausar: pausarSessao }))
      })

      it('ordena as palavras por início e, no empate, pelo fim; e atualização tardia depois de revogar é ignorada', async () => {
        const view = render(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
        const atualizar = chamada()[3]
        act(() => atualizar({ palavras: [palavra('aqui.', 200, 450), palavra('Estou', 200, 350), palavra('Pode falar.', 10, 180, 'online-profissional')], finais: 3, estavelAteMs: 500 }))
        expect(screen.getAllByRole('textbox').map((campo) => (campo as HTMLInputElement).value)).toEqual(['Pode falar.', 'Estou', 'aqui.'])
        revogar(view, 'analiseIa', { online })
        await act(async () => atualizar({ palavras: [palavra('Tardia', 0, 100)], finais: 1, estavelAteMs: 100 }))
        expect(screen.queryByText('Tardia')).toBeNull()
      })

      it('uma atualização vazia não deixa alteração pendente quando a chamada termina', async () => {
        const view = render(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
        act(() => chamada()[3]({ palavras: [], finais: 0, estavelAteMs: 0 }))
        view.rerender(apresentar({ ...online, ativa: false }))
        await waitFor(() => expect(pendencias.mock.lastCall![0]).toBe(false))
      })

      it('cancelar durante a abertura aborta o pedido e esquece o resultado; com a sessão aberta não aborta', async () => {
        const aberta = abertura()
        vi.mocked(transcreverOnline).mockReturnValueOnce(aberta.promise)
        const view = render(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
        const sinal = chamada()[2]
        view.rerender(apresentar({ ...online, ativa: false }))
        expect(sinal.aborted).toBe(true)
        await act(async () => aberta.resolve({ encerrar: encerrarSessao, pausar: pausarSessao }))
        expect(screen.queryByText('Transcrição online ao vivo. Cada trilha identifica quem está falando.')).toBeNull()
        expect(encerrarSessao).toHaveBeenCalledOnce()
        view.rerender(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledTimes(2))
        await screen.findByText('Transcrição online ao vivo. Cada trilha identifica quem está falando.')
        const sinalAberto = chamada()[2]
        view.rerender(apresentar({ ...online, ativa: false }))
        await waitFor(() => expect(encerrarSessao).toHaveBeenCalledTimes(2))
        expect(sinalAberto.aborted).toBe(false)
      })

      it('falha na abertura não acusa o erro se a chamada já foi cancelada, nem tenta encerrar uma sessão que não existe', async () => {
        const aberta = abertura()
        vi.mocked(transcreverOnline).mockReturnValueOnce(aberta.promise)
        const view = render(apresentar())
        await waitFor(() => expect(transcreverOnline).toHaveBeenCalledOnce())
        view.rerender(apresentar({ ...online, ativa: false }))
        await act(async () => aberta.reject(new Error('offline')))
        expect(screen.queryByRole('alert')).toBeNull()
        vi.mocked(transcreverOnline).mockRejectedValueOnce(new Error('offline'))
        view.rerender(apresentar())
        await screen.findByText('Não foi possível transcrever a chamada. O áudio não foi salvo.')
        view.rerender(apresentar({ ...online, ativa: false }))
        await act(async () => {})
        expect(screen.queryByText('A transcrição foi interrompida. Revise o texto recuperado.')).toBeNull()
      })
    })
  })
})
