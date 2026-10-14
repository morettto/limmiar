import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as patients from '../../entities/patient/api'
import { openRecord, sealNewPatient } from '../../entities/patient/patient-crypto'
import { PatientList } from './PatientList'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, className, children }: { to: string; params: { patientId: string }; className: string; children: React.ReactNode }) =>
    <a href={to.replace('$patientId', params.patientId)} className={className}>{children}</a>,
}))

let kek: CryptoKey
const date = '2026-10-01T12:00:00Z'
const onChanged = vi.fn()
function lista(accessToken = 'token', aviso: (() => void) | undefined = onChanged) {
  return <I18nProvider i18n={i18n}><PatientList baseUrl="" accountId="conta" accessToken={accessToken} kek={kek} onChanged={aviso} /></I18nProvider>
}
function montar() { return render(lista()) }
async function selar(nome: string, patientId = 'outro') {
  const selado = await sealNewPatient(kek, patientId, new TextEncoder().encode(JSON.stringify({ name: nome, risk: 'baixo' })))
  return { patientId, ...selado, createdAt: date }
}

describe('PatientList', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  beforeEach(async () => {
    kek = await webcrypto.importKek(new Uint8Array(32).fill(4))
    const selado = await sealNewPatient(kek, 'paciente', new TextEncoder().encode(JSON.stringify({ name: 'Paciente fictício', risk: 'baixo' })))
    vi.spyOn(patients, 'listPatients').mockResolvedValue({ ok: true, patients: [{ patientId: 'paciente', ...selado, createdAt: date }] })
    vi.spyOn(patients, 'createPatient').mockResolvedValue({ ok: true, patientId: 'novo', createdAt: date })
  })
  afterEach(() => { cleanup(); onChanged.mockClear(); vi.restoreAllMocks() })

  it('mostra cada pasta como link para o prontuário do paciente', async () => {
    montar()
    const link = await screen.findByRole('link', { name: 'Paciente fictício' })
    expect(link.getAttribute('href')).toBe('/pacientes/paciente')
    expect(screen.getByText('1 pasta')).toBeTruthy()
  })

  it('filtra as pastas pelo nome decifrado sem pedir busca ao servidor', async () => {
    montar(); await screen.findByRole('link', { name: 'Paciente fictício' })
    fireEvent.change(screen.getByLabelText('Buscar paciente nesta carteira'), { target: { value: 'não existe' } })
    expect(screen.queryByRole('link', { name: 'Paciente fictício' })).toBeNull()
    expect(screen.getByText('Nenhum paciente corresponde à busca.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Buscar paciente nesta carteira'), { target: { value: 'FICTÍCIO' } })
    expect(screen.getByRole('link', { name: 'Paciente fictício' })).toBeTruthy()
    expect(patients.listPatients).toHaveBeenCalledOnce()
  })

  it('convida a adicionar o primeiro paciente quando a carteira está vazia', async () => {
    vi.mocked(patients.listPatients).mockResolvedValue({ ok: true, patients: [] })
    montar()
    expect(await screen.findByText('Adicione seu primeiro paciente para abrir o prontuário.')).toBeTruthy()
  })

  it.each(['rede caiu', null, { ok: false as const, code: 'patients.not_found', params: {} }])('informa falha de listagem: %j', async (falha) => {
    if (falha !== null && typeof falha === 'object') vi.mocked(patients.listPatients).mockResolvedValueOnce(falha)
    else vi.mocked(patients.listPatients).mockRejectedValueOnce(falha === null ? 'falha' : new Error(falha))
    montar()
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Paciente fictício' })).toBeNull()
  })

  it('ignora listagem que termina depois de desmontar, inclusive uma falha tardia', async () => {
    let resolver!: (valor: patients.ListPatientsResult) => void
    vi.mocked(patients.listPatients).mockImplementationOnce(() => new Promise((resolve) => { resolver = resolve }))
    const view = montar(); view.unmount()
    await act(async () => resolver({ ok: true, patients: [] }))
    let rejeitar!: (erro: unknown) => void
    vi.mocked(patients.listPatients).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejeitar = reject }))
    const outra = montar(); outra.unmount()
    await act(async () => rejeitar(new Error('resposta tardia')))
    let recusar!: (valor: patients.ListPatientsResult) => void
    vi.mocked(patients.listPatients).mockImplementationOnce(() => new Promise((resolve) => { recusar = resolve }))
    const terceira = montar(); terceira.unmount()
    await act(async () => recusar({ ok: false, code: 'patients.not_found', params: {} }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('mantém um paciente com cifra inválida visível sem link para abrir o prontuário', async () => {
    vi.mocked(patients.listPatients).mockResolvedValueOnce({ ok: true,
      patients: [{ patientId: 'corrompido', wrappedDek: new Uint8Array(28), ciphertext: new Uint8Array(28), createdAt: date }] })
    montar()
    const pasta = await screen.findByText('Não foi possível ler o paciente')
    expect(pasta.closest('.patient-folder')?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('cria o paciente enviando só conteúdo cifrado, recarrega a carteira e avisa o painel', async () => {
    montar(); await screen.findByRole('link', { name: 'Paciente fictício' })
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: ' Novo paciente ' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Risco avaliado pelo profissional' }), { target: { value: 'elevado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar paciente' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    const params = vi.mocked(patients.createPatient).mock.calls[0]![3]
    const aberto = await openRecord(kek, { wrappedDek: params.wrappedDek, entries: [{ sequence: 1, ciphertext: params.ciphertext }] }, params.patientId)
    expect(JSON.parse(new TextDecoder().decode(aberto.plaintexts[0]))).toEqual({ name: 'Novo paciente', risk: 'elevado' })
    expect(new TextDecoder().decode(params.ciphertext)).not.toContain('Novo paciente')
    expect(patients.listPatients).toHaveBeenCalledTimes(2)
    expect((screen.getByLabelText('Nome do paciente') as HTMLInputElement).value).toBe('')
  })

  it.each([{ ok: false as const, code: 'patients.not_found', params: {} }, 'falha de rede'])('informa falha de cadastro e mantém o nome digitado: %j', async (falha) => {
    if (typeof falha === 'string') vi.mocked(patients.createPatient).mockRejectedValueOnce(falha)
    else vi.mocked(patients.createPatient).mockResolvedValueOnce(falha)
    montar(); await screen.findByRole('link', { name: 'Paciente fictício' })
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: 'Outro paciente' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar paciente' }))
    await screen.findByRole('status')
    expect((screen.getByLabelText('Nome do paciente') as HTMLInputElement).value).toBe('Outro paciente')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('começa vazia e carregando, sem texto de carteira vazia nem de busca sem resultado', () => {
    vi.mocked(patients.listPatients).mockReturnValue(new Promise(() => {}))
    montar()
    expect(screen.getByRole('status').textContent).toBe('Abrindo sua carteira...')
    expect(screen.getByText('0 pastas')).toBeTruthy()
    expect(screen.queryByText('Adicione seu primeiro paciente para abrir o prontuário.')).toBeNull()
    expect(screen.queryByText('Nenhum paciente corresponde à busca.')).toBeNull()
    expect((screen.getByLabelText('Nome do paciente') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('region', { name: 'Pacientes' })).toBeTruthy()
  })

  it('depois de carregar não mostra aviso nenhum e cada pasta traz o ícone', async () => {
    montar()
    const link = await screen.findByRole('link', { name: 'Paciente fictício' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('Nenhum paciente corresponde à busca.')).toBeNull()
    expect(screen.queryByText('Adicione seu primeiro paciente para abrir o prontuário.')).toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('carteira vazia não diz que a busca não achou nada', async () => {
    vi.mocked(patients.listPatients).mockResolvedValue({ ok: true, patients: [] })
    montar()
    await screen.findByText('Adicione seu primeiro paciente para abrir o prontuário.')
    expect(screen.queryByText('Nenhum paciente corresponde à busca.')).toBeNull()
    expect(screen.getByText('0 pastas')).toBeTruthy()
  })

  it('só habilita adicionar com um nome que não seja só espaços e o bloqueia enquanto cria', async () => {
    const criacao = deferred<patients.CreatePatientResult>()
    vi.mocked(patients.createPatient).mockReturnValueOnce(criacao.promise)
    montar(); await screen.findByRole('link', { name: 'Paciente fictício' })
    const adicionar = screen.getByRole('button', { name: 'Adicionar paciente' })
    expect(adicionar).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: '   ' } })
    expect(adicionar).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: 'Ana' } })
    expect(adicionar).toHaveProperty('disabled', false)
    fireEvent.click(adicionar)
    await waitFor(() => expect(patients.createPatient).toHaveBeenCalledOnce())
    expect(adicionar).toHaveProperty('disabled', true)
    await act(async () => criacao.resolve({ ok: true, patientId: 'novo', createdAt: date }))
  })

  it('cadastra com risco baixo por padrão, sem exigir o aviso ao painel, e relê a carteira a cada cadastro', async () => {
    const carregando = deferred<patients.ListPatientsResult>()
    render(lista('token', undefined)); await screen.findByRole('link', { name: 'Paciente fictício' })
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar paciente' }))
    await waitFor(() => expect(patients.listPatients).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    const primeiro = vi.mocked(patients.createPatient).mock.calls[0]![3]
    const aberto = await openRecord(kek, { wrappedDek: primeiro.wrappedDek, entries: [{ sequence: 1, ciphertext: primeiro.ciphertext }] }, primeiro.patientId)
    expect(JSON.parse(new TextDecoder().decode(aberto.plaintexts[0]))).toEqual({ name: 'Ana', risk: 'baixo' })

    vi.mocked(patients.listPatients).mockReturnValueOnce(carregando.promise)
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: 'Bia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar paciente' }))
    await waitFor(() => expect(patients.listPatients).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('status').textContent).toBe('Abrindo sua carteira...')
    await act(async () => carregando.resolve({ ok: true, patients: [] }))
  })

  it('mostra o motivo da falha de listagem e do cadastro com o texto certo', async () => {
    vi.mocked(patients.listPatients).mockResolvedValueOnce({ ok: false, code: 'patients.not_found', params: {} })
    const recusada = montar()
    expect(await screen.findByText('Prontuário não encontrado.')).toBeTruthy()
    recusada.unmount()

    vi.mocked(patients.listPatients).mockRejectedValueOnce(new Error('rede caiu'))
    const comErro = montar()
    expect(await screen.findByText('rede caiu')).toBeTruthy()
    comErro.unmount()

    vi.mocked(patients.listPatients).mockRejectedValueOnce('falha')
    const semErro = montar()
    expect(await screen.findByText('Não foi possível carregar os pacientes.')).toBeTruthy()
    semErro.unmount()

    vi.mocked(patients.createPatient).mockResolvedValueOnce({ ok: false, code: 'patients.not_found', params: {} })
    montar(); await screen.findByRole('link', { name: 'Paciente fictício' })
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar paciente' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Prontuário não encontrado.'))
    expect(screen.getByRole('button', { name: 'Adicionar paciente' })).toHaveProperty('disabled', false)
  })

  it('falha de rede no cadastro sem mensagem própria usa o texto padrão e libera o botão', async () => {
    vi.mocked(patients.createPatient).mockRejectedValueOnce('falha de rede')
    montar(); await screen.findByRole('link', { name: 'Paciente fictício' })
    fireEvent.change(screen.getByLabelText('Nome do paciente'), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar paciente' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Não foi possível concluir. Tente novamente.'))
    expect(screen.getByRole('button', { name: 'Adicionar paciente' })).toHaveProperty('disabled', false)
  })

  it('uma resposta tardia de outra sessão nunca sobrescreve a carteira atual', async () => {
    const antiga = deferred<patients.ListPatientsResult>()
    vi.mocked(patients.listPatients).mockReturnValueOnce(antiga.promise)
    const view = render(lista('token-antigo'))
    const atual = deferred<patients.ListPatientsResult>()
    vi.mocked(patients.listPatients).mockReturnValueOnce(atual.promise)
    view.rerender(lista('token-novo'))

    await act(async () => { antiga.resolve({ ok: true, patients: [await selar('Paciente antigo')] }); await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(screen.queryByText('Paciente antigo')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Abrindo sua carteira...')

    await act(async () => atual.resolve({ ok: true, patients: [await selar('Paciente atual', 'atual')] }))
    await screen.findByRole('link', { name: 'Paciente atual' })
    expect(screen.queryByText('Paciente antigo')).toBeNull()
  })

  it('uma falha tardia de outra sessão não aparece sobre a carteira atual', async () => {
    const antiga = deferred<patients.ListPatientsResult>()
    vi.mocked(patients.listPatients).mockReturnValueOnce(antiga.promise)
    const view = render(lista('token-antigo'))
    view.rerender(lista('token-novo'))
    await screen.findByRole('link', { name: 'Paciente fictício' })

    await act(async () => antiga.resolve({ ok: false, code: 'patients.not_found', params: {} }))
    expect(screen.queryByRole('status')).toBeNull()

    const rejeitada = deferred<patients.ListPatientsResult>()
    vi.mocked(patients.listPatients).mockReturnValueOnce(rejeitada.promise)
    view.rerender(lista('token-antigo'))
    view.rerender(lista('token-novo'))
    await screen.findByRole('link', { name: 'Paciente fictício' })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await act(async () => rejeitada.reject(new Error('rede caiu')))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
