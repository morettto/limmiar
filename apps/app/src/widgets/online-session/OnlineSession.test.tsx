import { useEffect } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { criarSessaoOnline, encerrarSessaoOnline } from '../../entities/online-session/api'
import { SessionReview } from '../../features/live-session/SessionReview'
import { OnlineCall } from '../../features/online-call/OnlineCall'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import { OnlineSession, type OnlineSessionProps } from './OnlineSession'

vi.mock('../../entities/online-session/api', () => ({ criarSessaoOnline: vi.fn(), encerrarSessaoOnline: vi.fn() }))
vi.mock('../../features/live-session/SessionReview', () => ({ SessionReview: vi.fn() }))
vi.mock('../../features/online-call/OnlineCall', () => ({ OnlineCall: vi.fn(() => <div>chamada</div>) }))
const finalizar = vi.fn(async () => {})
const pendencias = vi.fn()
const convite = { roomId: 'sala', patientToken: 'cap-paciente', professionalToken: 'cap-profissional', expiresAt: '2026-10-04T17:00:00Z' }
const local = {} as MediaStream, remoto = {} as MediaStream
const props: OnlineSessionProps = { baseUrl: '/api', accountId: 'conta', accessToken: 'token', patientId: 'registro',
  kek: {} as CryptoKey, paciente: { id: 'registro', nome: 'local', dek: {} as CryptoKey, transcricoes: [],
    consentimentos: { gravacao: 'concedido', analiseIa: 'concedido' } }, atendimentoId: 'atendimento-1', onPendingChange: pendencias }
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(() => {
  vi.mocked(criarSessaoOnline).mockResolvedValue({ ok: true, convite })
  vi.mocked(encerrarSessaoOnline).mockResolvedValue({ ok: true })
  vi.mocked(SessionReview).mockImplementation(({ prepararEncerramento, onPendingChange, online }) => {
    useEffect(() => { prepararEncerramento?.(finalizar) }, [prepararEncerramento])
    return <div><output data-testid="ativa">{String(online?.ativa)}</output>
      <button onClick={() => onPendingChange(true)}>texto pendente</button>
      <button onClick={() => onPendingChange(false)}>texto salvo</button></div>
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
async function montar() {
  render(<I18nProvider i18n={i18n}><OnlineSession {...props} /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de sessão online' }))
  return screen.findByLabelText('Link privado da sessão online')
}

it('repassa a proposta bibliográfica, a sessão e a transcrição salva à revisão da sessão online', async () => {
  const onPropostaReferencia = vi.fn()
  const transcricao = { id: 'atendimento-1', patientId: 'registro', revisao: 0, autorId: 'conta', registradaEm: '2026-10-04T17:00:00Z', palavras: [], papeis: {} }
  render(<I18nProvider i18n={i18n}><OnlineSession {...props} transcricao={transcricao} onPropostaReferencia={onPropostaReferencia} /></I18nProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de sessão online' }))
  await screen.findByLabelText('Link privado da sessão online')
  const revisao = vi.mocked(SessionReview).mock.lastCall![0]
  expect(revisao.onPropostaReferencia).toBe(onPropostaReferencia)
  expect(revisao).toMatchObject({ atendimentoId: 'atendimento-1', transcricao })
})
function callbacks() { return vi.mocked(OnlineCall).mock.lastCall![0] }

describe('sessão online vinculada ao prontuário', () => {
  it.each([{ atendimentoEncerrado: true }, { bloqueada: true }])('impede gerar convite durante encerramento ou depois dele: %j', estado => {
    render(<I18nProvider i18n={i18n}><OnlineSession {...props} {...estado} /></I18nProvider>)
    const gerar = screen.getByRole('button', { name: 'Gerar convite de sessão online' })
    expect((gerar as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(gerar)
    expect(criarSessaoOnline).not.toHaveBeenCalled()
  })

  it('gera convite por ID e expõe apenas a credencial do paciente no fragmento do link', async () => {
    const link = await montar() as HTMLInputElement
    expect(criarSessaoOnline).toHaveBeenCalledExactlyOnceWith('/api', 'conta', 'token', 'registro')
    const url = new URL(link.value)
    expect(url.pathname).toBe('/session/online'); expect(url.search).toBe('')
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe('cap-paciente')
    expect(link.value).not.toContain('cap-profissional')
    const selecionar = vi.spyOn(link, 'select')
    fireEvent.focus(link)
    expect(selecionar).toHaveBeenCalledOnce()
    expect(callbacks()).toMatchObject({ papel: 'professional', token: 'cap-profissional', roomId: 'sala' })
    expect(pendencias).toHaveBeenLastCalledWith(true)
  })
  it.each(['problema', 'rede'])('informa falha ao criar convite por %s e permite tentar novamente', async causa => {
    if (causa === 'problema') vi.mocked(criarSessaoOnline).mockResolvedValueOnce({ ok: false, code: 'access.denied', params: {} })
    else vi.mocked(criarSessaoOnline).mockRejectedValueOnce(new Error('offline'))
    render(<I18nProvider i18n={i18n}><OnlineSession {...props} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de sessão online' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(pendencias).toHaveBeenLastCalledWith(false))
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de sessão online' }))
    await screen.findByLabelText('Link privado da sessão online')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('ativa a transcrição apenas com conexão e conserva as mesmas trilhas em notificações repetidas', async () => {
    await montar()
    act(() => callbacks().onStreams!(local, remoto))
    act(() => callbacks().onStreams!(local, remoto))
    expect(vi.mocked(SessionReview).mock.lastCall![0].online).toMatchObject({ local, remoto, ativa: false })
    act(() => callbacks().onState!('conectada'))
    expect(screen.getByTestId('ativa').textContent).toBe('true')
    act(() => callbacks().onState!('interrompida'))
    expect(screen.getByTestId('ativa').textContent).toBe('false')
    await act(async () => callbacks().antesDeEncerrar!())
    expect(finalizar).toHaveBeenCalledOnce()
  })
  it('aguarda o texto final antes de revogar o convite e mantém a revisão após encerrar', async () => {
    let concluir!: () => void
    finalizar.mockImplementationOnce(() => new Promise<void>(resolve => { concluir = resolve }))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'texto pendente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e revogar convite online' }))
    expect(encerrarSessaoOnline).not.toHaveBeenCalled()
    await act(async () => concluir())
    await screen.findByText('Convite online encerrado.')
    expect(encerrarSessaoOnline).toHaveBeenCalledExactlyOnceWith('/api', 'conta', 'token', 'sala')
    expect(screen.queryByLabelText('Link privado da sessão online')).toBeNull()
    expect(screen.getByTestId('ativa').textContent).toBe('false')
    expect(pendencias).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'texto salvo' }))
    await waitFor(() => expect(pendencias).toHaveBeenLastCalledWith(false))
  })
  it('aceita revogação repetida de um convite já encerrado', async () => {
    vi.mocked(encerrarSessaoOnline).mockResolvedValueOnce({ ok: false, code: 'link.invite_not_found', params: {} })
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e revogar convite online' }))
    await screen.findByText('Convite online encerrado.')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it.each(['problema', 'rede', 'transcricao'])('preserva revisão e permite repetir o encerramento após falha de %s', async causa => {
    if (causa === 'problema') vi.mocked(encerrarSessaoOnline).mockResolvedValueOnce({ ok: false, code: 'access.denied', params: {} })
    else if (causa === 'rede') vi.mocked(encerrarSessaoOnline).mockRejectedValueOnce(new Error('offline'))
    else finalizar.mockRejectedValueOnce(new Error('texto final indisponível'))
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e revogar convite online' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Link privado da sessão online')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e revogar convite online' }))
    await screen.findByText('Convite online encerrado.')
  })
  it('revoga uma única vez ao receber encerramento repetido da chamada', async () => {
    await montar()
    const receberEstado = callbacks().onState!
    await act(async () => { receberEstado('encerrada'); receberEstado('encerrada') })
    await screen.findByText('Convite online encerrado.')
    expect(encerrarSessaoOnline).toHaveBeenCalledOnce()
  })
})

describe('sessão online: estados e textos', () => {
  it('abre sem convite, sem aviso de encerramento, com a seção nomeada e as trilhas ainda nulas', async () => {
    render(<I18nProvider i18n={i18n}><OnlineSession {...props} /></I18nProvider>)
    expect(screen.getByRole('region', { name: 'Convite da sessão online' })).toBeTruthy()
    expect(screen.queryByText('Convite online encerrado.')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de sessão online' }))
    await screen.findByLabelText('Link privado da sessão online')
    expect(vi.mocked(SessionReview).mock.lastCall![0].online).toEqual({ local: null, remoto: null, ativa: false })
  })

  it('bloqueia o botão de gerar enquanto cria e mostra a mensagem própria quando falha', async () => {
    const criacao = deferred<Awaited<ReturnType<typeof criarSessaoOnline>>>()
    vi.mocked(criarSessaoOnline).mockReturnValueOnce(criacao.promise)
    render(<I18nProvider i18n={i18n}><OnlineSession {...props} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite de sessão online' }))
    expect(screen.getByRole('button', { name: 'Gerar convite de sessão online' })).toHaveProperty('disabled', true)
    await act(async () => criacao.reject(new Error('offline')))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível criar o convite da sessão online.')
    expect(screen.getByRole('button', { name: 'Gerar convite de sessão online' })).toHaveProperty('disabled', false)
  })

  it('bloqueia o encerramento enquanto revoga e mostra a mensagem própria quando falha', async () => {
    const revogacao = deferred<Awaited<ReturnType<typeof encerrarSessaoOnline>>>()
    vi.mocked(encerrarSessaoOnline).mockReturnValueOnce(revogacao.promise)
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e revogar convite online' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Encerrar e revogar convite online' })).toHaveProperty('disabled', true))
    await act(async () => revogacao.reject(new Error('offline')))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível revogar o convite. Tente encerrar novamente.')
    expect(screen.getByRole('button', { name: 'Encerrar e revogar convite online' })).toHaveProperty('disabled', false)
  })

  it('só troca as trilhas quando alguma delas muda', async () => {
    await montar()
    const outroRemoto = {} as MediaStream, outroLocal = {} as MediaStream
    act(() => callbacks().onStreams!(local, remoto))
    const renders = vi.mocked(SessionReview).mock.calls.length
    act(() => callbacks().onStreams!(local, remoto))
    expect(vi.mocked(SessionReview).mock.calls.length).toBe(renders)
    act(() => callbacks().onStreams!(local, outroRemoto))
    expect(vi.mocked(SessionReview).mock.lastCall![0].online).toMatchObject({ local, remoto: outroRemoto })
    act(() => callbacks().onStreams!(outroLocal, outroRemoto))
    expect(vi.mocked(SessionReview).mock.lastCall![0].online).toMatchObject({ local: outroLocal, remoto: outroRemoto })
  })

  it('encerra sem esperar texto quando a revisão não registrou nada a finalizar', async () => {
    vi.mocked(SessionReview).mockImplementation(() => <div />)
    await montar()
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e revogar convite online' }))
    await screen.findByText('Convite online encerrado.')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
