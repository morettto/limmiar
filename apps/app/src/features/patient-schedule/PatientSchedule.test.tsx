import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { renderToString } from 'react-dom/server'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as agenda from '../../entities/agenda/api'
import { PatientSchedule } from './PatientSchedule'

const props = { baseUrl: '', accountId: 'conta', accessToken: 'token', patientId: 'paciente', iniciadas: new Set<string>() }
const encontro = { sessionId: 'sessao', patientId: 'paciente', inicioEm: '2026-10-04T14:00:00Z', duracaoMinutos: 50 }
const falha = { ok: false as const, code: 'agenda.slot_taken', params: {} }
function montar(onChanged?: () => void, iniciadas = props.iniciadas) {
  return render(<I18nProvider i18n={i18n}><PatientSchedule {...props} iniciadas={iniciadas} onChanged={onChanged} /></I18nProvider>)
}
async function formulario() {
  await screen.findByText('Nenhuma sessão agendada nesta semana.')
  fireEvent.change(screen.getByLabelText('Data e horário'), { target: { value: '2026-10-04T11:00' } })
}
beforeAll(() => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('agenda do prontuário', () => {
  it('agendar/remarcar/cancelar usa conta, ID opaco e horários reais; nenhuma identidade clínica', async () => {
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    const criar = vi.spyOn(agenda, 'agendarSessao').mockResolvedValue({ ok: true, sessionId: 'sessao-nova' })
    const remarcar = vi.spyOn(agenda, 'remarcarSessao').mockResolvedValue({ ok: true })
    const cancelar = vi.spyOn(agenda, 'cancelarSessao').mockResolvedValue({ ok: true })
    const onChanged = vi.fn()
    montar(onChanged); await formulario()
    listar.mockResolvedValue({ ok: true, sessoes: [encontro, { ...encontro, sessionId: 'outro', patientId: 'outra-pessoa' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Agendar sessão' }))
    await screen.findByText('Sessão agendada.')
    expect(criar).toHaveBeenCalledWith('', 'conta', 'token', 'paciente', new Date('2026-10-04T11:00').toISOString(), 50)
    expect(await screen.findAllByRole('button', { name: 'Remarcar sessão' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar sessão' }))
    fireEvent.change(screen.getByLabelText('Duração em minutos'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar novo horário' }))
    await screen.findByText('Sessão remarcada.')
    expect(remarcar).toHaveBeenCalledWith('', 'conta', 'token', 'sessao', new Date(encontro.inicioEm).toISOString(), 30)
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar sessão' }))
    listar.mockResolvedValue({ ok: true, sessoes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }))
    await screen.findByText('Sessão cancelada.')
    expect(cancelar).toHaveBeenCalledWith('', 'conta', 'token', 'sessao')
    expect(onChanged).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'Agendar sessão' })).toBeTruthy()
  })

  it('conflitos mantêm o formulário e permitem tentar de novo sem criar silenciosamente', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    const criar = vi.spyOn(agenda, 'agendarSessao').mockResolvedValue(falha)
    montar(); await formulario()
    fireEvent.click(screen.getByRole('button', { name: 'Agendar sessão' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', '2026-10-04T11:00')
    expect(screen.queryByText('Sessão agendada.')).toBeNull()
    criar.mockRejectedValueOnce('rede')
    fireEvent.click(screen.getByRole('button', { name: 'Agendar sessão' }))
    await screen.findByText('Não foi possível salvar a sessão.')
    criar.mockRejectedValueOnce(new Error('sem conexão'))
    fireEvent.click(screen.getByRole('button', { name: 'Agendar sessão' }))
    await screen.findByText('sem conexão')
  })

  it('recupera listagem com falha e descarta resposta atrasada de outra janela', async () => {
    let resolver!: (valor: agenda.ListarSessoesResult) => void
    const listar = vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(new Promise(resolve => { resolver = resolve })).mockResolvedValueOnce(falha)
    montar()
    fireEvent.change(screen.getByLabelText('Semana a partir de'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Semana a partir de'), { target: { value: '2026-11-01' } })
    await screen.findByRole('alert')
    await act(async () => resolver({ ok: true, sessoes: [encontro] }))
    expect(screen.queryByRole('button', { name: 'Remarcar sessão' })).toBeNull()
    listar.mockResolvedValue({ ok: true, sessoes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agenda' }))
    await screen.findByText('Nenhuma sessão agendada nesta semana.')
    const chamada = listar.mock.calls.at(-1)!
    expect(chamada.slice(0, 3)).toEqual(['', 'conta', 'token'])
    expect(chamada[4].getTime() - chamada[3].getTime()).toBe(7 * 86400000)
  })

  it('uma falha atrasada da janela anterior não apaga a agenda atual', async () => {
    let rejeitar!: (erro: Error) => void
    vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(new Promise((_, reject) => { rejeitar = reject }))
      .mockResolvedValue({ ok: true, sessoes: [encontro] })
    montar()
    fireEvent.change(screen.getByLabelText('Semana a partir de'), { target: { value: '2026-11-01' } })
    await screen.findByRole('button', { name: 'Remarcar sessão' })
    await act(async () => rejeitar(new Error('resposta antiga')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelar sessão' })).toBeTruthy()
  })

  it('um agendamento que já tem sessão não pode mais ser remarcado nem cancelado', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [encontro, { ...encontro, sessionId: 'outro' }] })
    montar(undefined, new Set([encontro.sessionId]))
    expect(await screen.findAllByRole('button', { name: 'Remarcar sessão' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancelar sessão' })).toHaveLength(1)
    expect(screen.getByText('Sessão iniciada')).toBeTruthy()
  })

  it('interrompe edição sem remarcar', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [encontro] })
    const remarcar = vi.spyOn(agenda, 'remarcarSessao')
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Remarcar sessão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar a agendar' }))
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', '')
    expect(remarcar).not.toHaveBeenCalled()
  })

  it('falha de cancelamento não retira a sessão nem abandona a edição', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [encontro] })
    const cancelar = vi.spyOn(agenda, 'cancelarSessao').mockResolvedValue(falha)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Remarcar sessão' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Salvar novo horário' })).toBeTruthy()
    cancelar.mockRejectedValueOnce(new Error('desconectado'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }))
    await screen.findByText('desconectado')
    cancelar.mockRejectedValueOnce('rede')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }))
    await screen.findByText('Não foi possível cancelar a sessão.')
    cancelar.mockResolvedValueOnce({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Voltar a agendar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }))
    await screen.findByText('Sessão cancelada.')
  })
})

describe('agenda do prontuário: estado e textos', () => {
  const sala = (id: string, inicioEm = encontro.inicioEm) => ({ ...encontro, sessionId: id, inicioEm })
  const salvar = () => screen.getByRole('button', { name: /^(Agendar sessão|Salvar novo horário)$/ })

  it('na primeira renderização a agenda já está carregando, sem afirmar que não há sessões', () => {
    const html = renderToString(<I18nProvider i18n={i18n}><PatientSchedule {...props} /></I18nProvider>)
    expect(html).toContain('Carregando sessões...')
    expect(html).not.toContain('Nenhuma sessão agendada nesta semana.')
  })

  it('abre na semana de hoje no horário local, formulário vazio e rotulado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 5, 9, 7))
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    montar()
    await screen.findByText('Nenhuma sessão agendada nesta semana.')
    expect(screen.getByLabelText('Semana a partir de')).toHaveProperty('value', '2026-01-05')
    expect(listar.mock.calls[0]![3]).toEqual(new Date(2026, 0, 5))
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', '')
    expect(salvar()).toHaveProperty('disabled', true)
    expect(screen.getByRole('region', { name: 'Agenda deste paciente' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Agendar próximo encontro')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Voltar a agendar' })).toBeNull()
  })

  it('ao remarcar mostra o horário local da sessão com zeros à esquerda e o título de remarcação', async () => {
    const inicio = new Date(2026, 0, 5, 9, 7)
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [sala('a', inicio.toISOString())] })
    montar()
    const horario = Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(inicio)
    expect((await screen.findByText(horario)).parentElement!.textContent).toBe(`${horario} · 50 minutos`)
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar sessão' }))
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', '2026-01-05T09:07')
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Novo horário da sessão')
    expect(screen.getByLabelText('Duração em minutos')).toHaveProperty('value', '50')
    expect(screen.getByRole('button', { name: 'Voltar a agendar' })).toBeTruthy()
  })

  it('a mensagem da listagem com falha é a de agenda indisponível e some o aviso de vazio', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue(falha)
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar a agenda. Atualize para tentar novamente.')
    expect(screen.queryByText('Nenhuma sessão agendada nesta semana.')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('com sessões ou carregando não afirma que a semana está vazia', async () => {
    const lenta = deferred<agenda.ListarSessoesResult>()
    vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(lenta.promise)
    montar()
    expect(screen.getByRole('status').textContent).toBe('Carregando sessões...')
    expect(screen.queryByText('Nenhuma sessão agendada nesta semana.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Atualizar agenda' })).toHaveProperty('disabled', true)
    await act(async () => lenta.resolve({ ok: true, sessoes: [sala('a')] }))
    await screen.findByRole('button', { name: 'Remarcar sessão' })
    expect(screen.queryByText('Nenhuma sessão agendada nesta semana.')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Atualizar agenda' })).toHaveProperty('disabled', false)
  })

  it('mudar a semana para vazio mantém a data e não consulta de novo', async () => {
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    montar()
    await screen.findByText('Nenhuma sessão agendada nesta semana.')
    fireEvent.change(screen.getByLabelText('Semana a partir de'), { target: { value: '2026-11-01' } })
    await screen.findByText('Nenhuma sessão agendada nesta semana.')
    expect(listar).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('Semana a partir de'), { target: { value: '' } })
    expect(screen.getByLabelText('Semana a partir de')).toHaveProperty('value', '2026-11-01')
    expect(listar).toHaveBeenCalledTimes(2)
  })

  it('a finalização tardia de uma janela anterior não encerra o carregamento da atual', async () => {
    const antiga = deferred<agenda.ListarSessoesResult>()
    const atual = deferred<agenda.ListarSessoesResult>()
    vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    montar()
    fireEvent.change(screen.getByLabelText('Semana a partir de'), { target: { value: '2026-11-01' } })
    await act(async () => antiga.resolve({ ok: true, sessoes: [] }))
    expect(screen.getByRole('status').textContent).toBe('Carregando sessões...')
    await act(async () => atual.resolve({ ok: true, sessoes: [] }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('atualizar relê a agenda a cada clique', async () => {
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    montar()
    await screen.findByText('Nenhuma sessão agendada nesta semana.')
    for (const total of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar agenda' }))
      await waitFor(() => expect(listar).toHaveBeenCalledTimes(total))
      await screen.findByText('Nenhuma sessão agendada nesta semana.')
    }
  })

  it('só aceita agendar com horário e duração inteira entre 1 e 1440 minutos', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    montar(); await formulario()
    const duracao = screen.getByLabelText('Duração em minutos')
    expect(salvar()).toHaveProperty('disabled', false)
    for (const [valor, desabilitado] of [['', true], ['0', true], ['1', false], ['30.5', true], ['1440', false], ['1441', true], ['50', false]] as const) {
      fireEvent.change(duracao, { target: { value: valor } })
      expect(salvar(), `duração "${valor}"`).toHaveProperty('disabled', desabilitado)
    }
    fireEvent.change(screen.getByLabelText('Data e horário'), { target: { value: '' } })
    expect(salvar()).toHaveProperty('disabled', true)
  })

  it('bloqueia o formulário e a agenda enquanto agenda e depois limpa o horário para o próximo', async () => {
    const lenta = deferred<agenda.AgendarSessaoResult>()
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [] })
    vi.spyOn(agenda, 'agendarSessao').mockReturnValueOnce(lenta.promise)
    montar(undefined); await formulario()
    fireEvent.click(salvar())
    await waitFor(() => expect(salvar()).toHaveProperty('disabled', true))
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Duração em minutos')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Semana a partir de')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Atualizar agenda' })).toHaveProperty('disabled', true)
    await act(async () => lenta.resolve({ ok: true, sessionId: 'nova' }))
    await screen.findByText('Sessão agendada.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', '')
    expect(salvar()).toHaveProperty('disabled', true)
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2))

    vi.spyOn(agenda, 'agendarSessao').mockResolvedValue({ ok: true, sessionId: 'outra' })
    fireEvent.change(screen.getByLabelText('Data e horário'), { target: { value: '2026-10-05T10:00' } })
    fireEvent.click(salvar())
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(3))
  })

  it('cancelar bloqueia a agenda, relê a cada cancelamento e só sai da edição da sessão cancelada', async () => {
    const lenta = deferred<agenda.SalvarSessaoResult>()
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [sala('a'), sala('b', '2026-10-05T14:00:00Z')] })
    const cancelar = vi.spyOn(agenda, 'cancelarSessao').mockReturnValueOnce(lenta.promise).mockResolvedValue({ ok: true })
    montar(undefined)
    const remarcar = await screen.findAllByRole('button', { name: 'Remarcar sessão' })
    fireEvent.click(remarcar[0]!)
    const editado = (screen.getByLabelText('Data e horário') as HTMLInputElement).value
    expect(editado).not.toBe('')
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar sessão' })[1]!)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cancelar sessão' })[0]).toHaveProperty('disabled', true))
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('disabled', true)
    await act(async () => lenta.resolve({ ok: true }))
    await screen.findByText('Sessão cancelada.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', editado)
    expect(screen.getByRole('button', { name: 'Salvar novo horário' })).toBeTruthy()
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar sessão' })[0]!)
    await waitFor(() => expect(cancelar).toHaveBeenCalledTimes(2))
    expect(cancelar.mock.calls[1]![3]).toBe('a')
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(3))
    expect(screen.getByLabelText('Data e horário')).toHaveProperty('value', '')
    expect(salvar().textContent).toBe('Agendar sessão')
    expect(salvar()).toHaveProperty('disabled', true)
  })

  it('agendar, remarcar e cancelar funcionam sem ninguém pedindo aviso de mudança', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [sala('a')] })
    vi.spyOn(agenda, 'agendarSessao').mockResolvedValue({ ok: true, sessionId: 'nova' })
    vi.spyOn(agenda, 'remarcarSessao').mockResolvedValue({ ok: true })
    vi.spyOn(agenda, 'cancelarSessao').mockResolvedValue({ ok: true })
    montar(undefined)
    await screen.findByRole('button', { name: 'Remarcar sessão' })
    fireEvent.change(screen.getByLabelText('Data e horário'), { target: { value: '2026-10-04T11:00' } })
    fireEvent.click(salvar())
    await screen.findByText('Sessão agendada.')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar sessão' }))
    fireEvent.click(salvar())
    await screen.findByText('Sessão remarcada.')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar sessão' }))
    await screen.findByText('Sessão cancelada.')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
