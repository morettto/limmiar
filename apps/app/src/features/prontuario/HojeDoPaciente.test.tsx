import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as agenda from '../../entities/agenda/api'
import type { Atendimento } from '../../entities/atendimento/atendimento'
import { HojeDoPaciente } from './HojeDoPaciente'
import { ProntuarioContext } from './prontuario-context'
import type { Prontuario } from './abrir-prontuario'
import * as iniciar from './iniciar-atendimento'

const navegar = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navegar,
  Link: ({ to, params, search, children, ref }: { to: string; params: { patientId: string; atendimentoId: string }; search: unknown; children: React.ReactNode; ref?: React.Ref<HTMLAnchorElement> }) =>
    <a ref={ref} data-search={JSON.stringify(search)} href={to.replace('$patientId', params.patientId).replace('$atendimentoId', params.atendimentoId)}>{children}</a>,
}))

const dek = {} as CryptoKey
const recarregar = vi.fn()
const sessao = (sessionId: string, patientId = 'paciente') => ({ sessionId, patientId, inicioEm: '2026-10-05T14:30:00.000Z', duracaoMinutos: 50 })
const atendimento: Atendimento = { id: 'atendimento-1', patientId: 'paciente', agendamentoId: 'agendamento-2', iniciadoEm: '2026-10-05T14:31:00.000Z' }

function hoje(atendimentos: Atendimento[] = [], destaque?: string, patientId = 'paciente') {
  return <I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: { dek, atendimentos } as Prontuario, recarregar }}>
    <HojeDoPaciente baseUrl="" accountId="conta" accessToken="token" patientId={patientId} destaque={destaque} />
  </ProntuarioContext.Provider></I18nProvider>
}
function montar(atendimentos: Atendimento[] = [], destaque?: string) { return render(hoje(atendimentos, destaque)) }
function agendaDeHoje(...sessoes: ReturnType<typeof sessao>[]) {
  vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes })
}

describe('HojeDoPaciente', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); navegar.mockReset(); recarregar.mockReset() })

  it('lista só os agendamentos de hoje deste paciente, com iniciar ou abrir conforme já tenham sessão', async () => {
    agendaDeHoje(sessao('agendamento-1'), sessao('agendamento-2'), sessao('agendamento-3', 'outro'))
    montar([atendimento])
    await screen.findByRole('link', { name: 'Abrir sessão' })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('50 minutos')
    expect(screen.getAllByRole('button', { name: 'Iniciar sessão' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Abrir sessão' }).getAttribute('href')).toBe('/pacientes/$patientId/sessoes/$atendimentoId'.replace('$patientId', 'paciente').replace('$atendimentoId', 'atendimento-1'))
    const [de, ate] = vi.mocked(agenda.listarSessoes).mock.calls[0]!.slice(3) as [Date, Date]
    expect(ate.getTime() - de.getTime()).toBeGreaterThanOrEqual(23 * 3_600_000)
    expect(de.getHours()).toBe(0)
  })

  it('diz que não há agendamento hoje e ainda deixa iniciar uma sessão agora', async () => {
    agendaDeHoje()
    montar()
    expect(await screen.findByText('Nenhum agendamento hoje')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Iniciar sessão agora' })).toBeTruthy()
  })

  it('inicia a sessão do agendamento, relê o prontuário e abre a página da sessão', async () => {
    agendaDeHoje(sessao('agendamento-1'))
    const iniciarAtendimento = vi.spyOn(iniciar, 'iniciarAtendimento').mockResolvedValue({ ...atendimento, agendamentoId: 'agendamento-1' })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar sessão' }))
    await waitFor(() => expect(navegar).toHaveBeenCalledOnce())
    expect(iniciarAtendimento).toHaveBeenCalledWith({ baseUrl: '', accountId: 'conta', accessToken: 'token', dek, patientId: 'paciente', agendamentoId: 'agendamento-1' })
    expect(recarregar).toHaveBeenCalledBefore(navegar)
    expect(navegar).toHaveBeenCalledWith({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId: 'paciente', atendimentoId: 'atendimento-1' }, search: { aba: 'insights' } })
  })

  it('Iniciar sessão agora não passa agendamento', async () => {
    agendaDeHoje()
    const iniciarAtendimento = vi.spyOn(iniciar, 'iniciarAtendimento').mockResolvedValue(atendimento)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar sessão agora' }))
    await waitFor(() => expect(navegar).toHaveBeenCalledOnce())
    expect(iniciarAtendimento).toHaveBeenCalledWith(expect.objectContaining({ agendamentoId: undefined }))
  })

  it.each([new Error('Conflito.'), 'sem objeto'])('mostra a falha ao iniciar e libera os botões: %s', async (falha) => {
    agendaDeHoje()
    vi.spyOn(iniciar, 'iniciarAtendimento').mockRejectedValue(falha)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar sessão agora' }))
    expect((await screen.findByRole('alert')).textContent).toBe(falha instanceof Error ? falha.message : 'Não foi possível iniciar a sessão.')
    expect(screen.getByRole('button', { name: 'Iniciar sessão agora' })).toHaveProperty('disabled', false)
    expect(navegar).not.toHaveBeenCalled()
  })

  it.each([
    ['problema da API', { ok: false as const, code: 'validation.invalid_field', params: { field: 'from' } }, 'Campo inválido: from.'],
    ['rede', new Error('Sem conexão'), 'Sem conexão'],
    ['valor sem objeto', 'falha', 'Não foi possível carregar a agenda.'],
  ])('mostra a falha da agenda (%s) e permite atualizar', async (_nome, falha, mensagem) => {
    const listar = vi.spyOn(agenda, 'listarSessoes')
    if (falha instanceof Error || typeof falha === 'string') listar.mockRejectedValueOnce(falha)
    else listar.mockResolvedValueOnce(falha)
    listar.mockResolvedValueOnce({ ok: true, sessoes: [] })
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe(mensagem)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agenda' }))
    expect(await screen.findByText('Nenhum agendamento hoje')).toBeTruthy()
  })

  it('destaca o agendamento vindo do painel e leva o foco ao botão de iniciar', async () => {
    agendaDeHoje(sessao('agendamento-1'), sessao('agendamento-2'))
    montar([atendimento], 'agendamento-1')
    const iniciarSessao = await screen.findByRole('button', { name: 'Iniciar sessão' })
    await waitFor(() => expect(document.activeElement).toBe(iniciarSessao))
    expect(iniciarSessao.closest('li')?.getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: 'Abrir sessão' }).closest('li')?.getAttribute('aria-current')).toBeNull()
  })

  it('se o agendamento destacado já tem sessão, o foco vai para abri-la', async () => {
    agendaDeHoje(sessao('agendamento-2'))
    montar([atendimento], 'agendamento-2')
    const abrir = await screen.findByRole('link', { name: 'Abrir sessão' })
    await waitFor(() => expect(document.activeElement).toBe(abrir))
  })

  it.each(['resposta', 'falha'])('ignora a %s da agenda que chega depois de desmontar', async (tipo) => {
    let resolver!: (valor: agenda.ListarSessoesResult) => void
    let rejeitar!: (erro: unknown) => void
    vi.spyOn(agenda, 'listarSessoes').mockReturnValue(new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject }))
    const view = montar()
    view.unmount()
    await act(async () => { if (tipo === 'resposta') resolver({ ok: true, sessoes: [sessao('agendamento-1')] }); else rejeitar(new Error('tarde')) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Iniciar sessão' })).toBeNull()
  })
})

describe('HojeDoPaciente: estados, textos e respostas tardias', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); navegar.mockReset(); recarregar.mockReset() })

  it('na primeira renderização a agenda já está carregando, sem afirmar que não há agendamentos', () => {
    const html = renderToString(hoje())
    expect(html).toContain('Carregando agenda de hoje...')
    expect(html).not.toContain('Nenhum agendamento hoje')
  })

  it('mostra a carga só enquanto lê e nunca o aviso de vazio durante a carga, com erro ou com sessões', async () => {
    const lenta = deferred<agenda.ListarSessoesResult>()
    vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(lenta.promise)
    montar()
    expect(screen.getByRole('status').textContent).toBe('Carregando agenda de hoje...')
    expect(screen.queryByText('Nenhum agendamento hoje')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('region', { name: 'Hoje' })).toBeTruthy()
    await act(async () => lenta.resolve({ ok: true, sessoes: [sessao('agendamento-1')] }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('Nenhum agendamento hoje')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('com a leitura falha não diz que está vazio nem mostra a carga', async () => {
    vi.spyOn(agenda, 'listarSessoes').mockRejectedValue(new Error('Sem conexão'))
    montar()
    await screen.findByRole('alert')
    expect(screen.queryByText('Nenhum agendamento hoje')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('cada pedido de atualização relê a agenda', async () => {
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: false, code: 'validation.invalid_field', params: { field: 'from' } })
    montar()
    await screen.findByRole('alert')
    for (const total of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar agenda' }))
      await waitFor(() => expect(listar).toHaveBeenCalledTimes(total))
    }
  })

  it('cada linha traz hora, duração e a ação separadas por pontuação e espaço, com a aba de insights', async () => {
    agendaDeHoje(sessao('agendamento-1'), sessao('agendamento-2'))
    montar([atendimento])
    await screen.findByRole('link', { name: 'Abrir sessão' })
    const hora = new Date('2026-10-05T14:30:00.000Z').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const [primeira, segunda] = screen.getAllByRole('listitem')
    expect(primeira!.textContent).toBe(`${hora} · 50 minutos Iniciar sessão`)
    expect(segunda!.textContent).toBe(`${hora} · 50 minutos Abrir sessão`)
    expect(screen.getByRole('link', { name: 'Abrir sessão' }).getAttribute('data-search')).toBe('{"aba":"insights"}')
  })

  it('bloqueia os botões enquanto inicia a sessão', async () => {
    agendaDeHoje(sessao('agendamento-1'))
    const inicio = deferred<Atendimento>()
    vi.spyOn(iniciar, 'iniciarAtendimento').mockReturnValue(inicio.promise)
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar sessão' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar sessão agora' })).toHaveProperty('disabled', true))
    expect(screen.getByRole('button', { name: 'Iniciar sessão' })).toHaveProperty('disabled', true)
    await act(async () => inicio.resolve(atendimento))
  })

  it('uma resposta tardia de outro paciente nunca substitui a agenda atual', async () => {
    const antiga = deferred<agenda.ListarSessoesResult>()
    const listar = vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(antiga.promise).mockResolvedValue({ ok: true, sessoes: [sessao('agendamento-novo', 'outro')] })
    const view = render(hoje())
    view.rerender(hoje([], undefined, 'outro'))
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())

    await act(async () => antiga.resolve({ ok: true, sessoes: [sessao('agendamento-antigo'), sessao('agendamento-novo', 'outro')] }))

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('uma falha tardia de outro paciente não aparece sobre a agenda atual e a carga da atual segue', async () => {
    const antiga = deferred<agenda.ListarSessoesResult>()
    const atual = deferred<agenda.ListarSessoesResult>()
    vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    const view = render(hoje())
    view.rerender(hoje([], undefined, 'outro'))

    await act(async () => antiga.reject(new Error('tarde')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Carregando agenda de hoje...')

    await act(async () => antiga.resolve({ ok: false, code: 'validation.invalid_field', params: { field: 'x' } }))
    await act(async () => atual.resolve({ ok: true, sessoes: [] }))
    expect(screen.getByText('Nenhum agendamento hoje')).toBeTruthy()
  })

  it('uma recusa tardia de outro paciente não aparece sobre a agenda atual', async () => {
    const antiga = deferred<agenda.ListarSessoesResult>()
    vi.spyOn(agenda, 'listarSessoes').mockReturnValueOnce(antiga.promise).mockResolvedValue({ ok: true, sessoes: [] })
    const view = render(hoje())
    view.rerender(hoje([], undefined, 'outro'))
    await screen.findByText('Nenhum agendamento hoje')

    await act(async () => antiga.resolve({ ok: false, code: 'validation.invalid_field', params: { field: 'x' } }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('não devolve o foco ao destaque enquanto a agenda recarrega', async () => {
    const listar = vi.spyOn(agenda, 'listarSessoes').mockResolvedValue({ ok: true, sessoes: [sessao('agendamento-1')] })
    const view = render(hoje([], 'agendamento-1'))
    const destacado = await screen.findByRole('button', { name: 'Iniciar sessão' })
    await waitFor(() => expect(document.activeElement).toBe(destacado))
    const agora = screen.getByRole('button', { name: 'Iniciar sessão agora' })
    agora.focus()
    const lenta = deferred<agenda.ListarSessoesResult>()
    listar.mockReturnValueOnce(lenta.promise)

    view.rerender(hoje([], 'agendamento-1', 'paciente-b'))
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2))

    expect(document.activeElement).toBe(agora)
    await act(async () => lenta.resolve({ ok: true, sessoes: [] }))
  })
})
