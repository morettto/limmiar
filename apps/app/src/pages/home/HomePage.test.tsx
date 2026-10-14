import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import { HomePage } from './HomePage'
import { carregarBiblioteca } from '../../features/nota-biblioteca/carregar-biblioteca'
import type { Nota } from '../../entities/nota/nota'
const navegar = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navegar }))
vi.mock('../../features/nota-biblioteca/carregar-biblioteca', () => ({ carregarBiblioteca: vi.fn() }))
vi.mock('../../widgets/painel-profissional/PainelProfissional', () => ({ PainelProfissional: ({ notas, versao, onStart, onOpenItem }: { notas: Nota[]; versao: number; onStart(id: string, agendamentoId: string): void; onOpenItem(id: string, atendimentoId?: string): void }) => <div>
  <p data-testid="painel-notas">{notas.map(nota => nota.id).join(',')}</p><span data-testid="painel-versao">{versao}</span><span data-testid="painel-quantidade">{notas.length}</span>
  <button onClick={() => onStart('paciente-2', 'agendamento-2')}>Próxima do painel</button><button onClick={() => onOpenItem('paciente-2', 'atendimento-2')}>Pendência do painel</button>
  <button onClick={() => onOpenItem('paciente-3')}>Risco do painel</button><p>Painel disponível</p>
</div> }))
const account = { id: 'conta-1', accessToken: 'access' }
const chaveiro = { kek: {} as CryptoKey, accountId: account.id, accessToken: account.accessToken }
function pagina(accessToken = account.accessToken) {
  return <I18nProvider i18n={i18n}><HomePage baseUrl="" chaveiro={{ ...chaveiro, accessToken }} /></I18nProvider>
}
function montar() { return render(pagina()) }
const ativa = () => new Response(JSON.stringify({ status: 'Active' }))
describe('HomePage', () => {
  beforeEach(() => vi.mocked(carregarBiblioteca).mockReset().mockResolvedValue({ notas: [], nomesPacientes: new Map() }))

  it('leva o painel à pasta com o agendamento, à aba da nota da sessão ou à pasta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'Active' })))
    vi.mocked(carregarBiblioteca).mockResolvedValue({ notas: [{ id: 'nota-2' } as Nota], nomesPacientes: new Map() })
    montar()
    await waitFor(() => expect(screen.getByTestId('painel-notas').textContent).toBe('nota-2'))
    expect(carregarBiblioteca).toHaveBeenCalledWith('', account.id, account.accessToken, chaveiro.kek)
    fireEvent.click(screen.getByRole('button', { name: 'Próxima do painel' }))
    expect(navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId', params: { patientId: 'paciente-2' }, search: { agendamento: 'agendamento-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pendência do painel' }))
    expect(navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId: 'paciente-2', atendimentoId: 'atendimento-2' }, search: { aba: 'nota' } })
    fireEvent.click(screen.getByRole('button', { name: 'Risco do painel' }))
    expect(navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId', params: { patientId: 'paciente-3' } })
  })

  it('exibe falha das notas sem derrubar o painel e repete a leitura', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'Active' })))
    vi.mocked(carregarBiblioteca).mockRejectedValueOnce(new Error('falha da assinatura'))
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar as notas pendentes. Tente novamente.')
    expect(screen.getByText('Painel disponível')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(carregarBiblioteca).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('painel-versao').textContent).toBe('1')
  })

  it.each(['resolver', 'rejeitar'])('ignora notas recebidas após desmontar: %s', async resultado => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'Active' })))
    let resolver!: (biblioteca: Awaited<ReturnType<typeof carregarBiblioteca>>) => void
    let rejeitar!: (erro: Error) => void
    vi.mocked(carregarBiblioteca).mockImplementationOnce(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject }))
    const view = montar()
    await screen.findByText('Carregando notas pendentes...')
    view.unmount()
    await act(async () => { if (resultado === 'resolver') resolver({ notas: [], nomesPacientes: new Map() }); else rejeitar(new Error('tardia')) })
    expect(screen.queryByTestId('painel-notas')).toBeNull()
  })
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); navegar.mockClear() })
  it('mantém prontuário fechado até aprovação e permite enviar documento e atualizar', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Pending' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'InReview' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'InReview' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Active' })))
    montar()
    fireEvent.change(await screen.findByLabelText('Referência do documento'), { target: { value: 'documento-local' } })
    expect(screen.queryByText('Painel disponível')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para revisão' }))
    expect(await screen.findByText('Documento recebido. Sua conta aguarda a aprovação da equipe.')).toBeTruthy()
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer access' }, body: JSON.stringify({ type: 'Document', documentReference: 'documento-local' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar verificação' }))
    expect(await screen.findByText('Painel disponível')).toBeTruthy()
  })
  it('mostra falha de rede sem abrir prontuário', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Sem conexão'))
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Sem conexão')
    expect(screen.queryByText('Painel disponível')).toBeNull()
  })
  it.each([null, {}, [], { status: 7 }, { status: 'inventado' }])('recusa estado malformado do servidor: %j', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)))
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Resposta de verificação inválida.')
  })

  it('exibe erro de autorização, recupera a verificação e abre o painel', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'validation.invalid_field', params: { field: 'accountId' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Active' })))
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Campo inválido: accountId.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Painel disponível')).toBeTruthy()
  })

  it.each([new Error('Falha no envio'), 'erro sem objeto', 'problema da API'])('mantém o formulário quando envio de documento falha: %s', async (erro) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Rejected' })))
    if (erro === 'problema da API') fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'validation.invalid_field', params: { field: 'documentReference' } }), { status: 400 }))
    else fetch.mockRejectedValueOnce(erro)
    montar()
    fireEvent.change(await screen.findByLabelText('Referência do documento'), { target: { value: 'documento' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para revisão' }))
    const texto = erro instanceof Error ? erro.message : erro === 'problema da API' ? 'Campo inválido: documentReference.' : 'Não foi possível enviar o documento.'
    expect((await screen.findByRole('alert')).textContent).toBe(texto)
    expect((screen.getByRole('button', { name: 'Enviar para revisão' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('trata erro sem objeto e ignora uma resposta recebida após desmontar', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('sem conexão')
    const view = montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar a conta.')
    view.unmount()
    let rejeitar!: (erro: Error) => void
    fetch.mockReturnValueOnce(new Promise((_resolve, reject) => { rejeitar = reject }))
    const outro = montar()
    outro.unmount()
    await act(async () => { rejeitar(new Error('resposta tardia')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['um problema da API', { code: 'validation.invalid_field', params: { field: 'accountId' } }, 400],
    ['um estado malformado', {}, 200],
  ])('ignora %s recebido após desmontar', async (_caso, corpo, status) => {
    let resolver!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    montar().unmount()
    await act(async () => { resolver(new Response(JSON.stringify(corpo), { status })) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignora uma aprovação recebida após desmontar', async () => {
    let resolver!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    const view = montar()
    view.unmount()
    await act(async () => { resolver(new Response(JSON.stringify({ status: 'Active' }))) })
    expect(screen.queryByText('Painel disponível')).toBeNull()
  })
})

describe('HomePage: estados e respostas tardias', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  beforeEach(() => vi.mocked(carregarBiblioteca).mockReset().mockResolvedValue({ notas: [], nomesPacientes: new Map() }))
  afterEach(() => { cleanup(); vi.restoreAllMocks(); navegar.mockClear() })

  it('consulta a verificação da própria conta com o token e só mostra a carga até a resposta', async () => {
    const resposta = deferred<Response>()
    const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(resposta.promise)
    montar()
    expect(screen.getByRole('status').textContent).toBe('Carregando sua conta...')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Verificação profissional')).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/accounts/conta-1/professional-verification', { headers: { Authorization: 'Bearer access' } })
    await act(async () => resposta.resolve(ativa()))
    await screen.findByText('Painel disponível')
    expect(screen.queryByText('Carregando sua conta...')).toBeNull()
    expect(screen.queryByText('Verificação profissional')).toBeNull()
    expect(screen.queryByText('Carregando notas pendentes...')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('com falha na verificação não mostra a carga nem o formulário', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Sem conexão'))
    montar()
    await screen.findByRole('alert')
    expect(screen.queryByText('Carregando sua conta...')).toBeNull()
    expect(screen.queryByText('Verificação profissional')).toBeNull()
  })

  it.each([7, 'Active', true])('recusa um corpo que nem é um objeto: %j', async (corpo) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(corpo)))
    montar()
    expect((await screen.findByRole('alert')).textContent).toBe('Resposta de verificação inválida.')
  })

  it('o formulário começa vazio, só envia com referência preenchida e manda o texto aparado', async () => {
    const envio = deferred<Response>()
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'Pending' })))
      .mockReturnValueOnce(envio.promise)
      .mockResolvedValue(new Response(JSON.stringify({ status: 'InReview' })))
    montar()
    const campo = await screen.findByLabelText('Referência do documento')
    const enviar = screen.getByRole('button', { name: 'Enviar para revisão' })
    expect(campo).toHaveProperty('value', '')
    expect(enviar).toHaveProperty('disabled', true)
    fireEvent.change(campo, { target: { value: '   ' } })
    expect(enviar).toHaveProperty('disabled', true)
    fireEvent.change(campo, { target: { value: '  documento-x  ' } })
    expect(enviar).toHaveProperty('disabled', false)
    fireEvent.click(enviar)
    await waitFor(() => expect(enviar).toHaveProperty('disabled', true))
    expect(screen.getByRole('button', { name: 'Atualizar verificação' })).toHaveProperty('disabled', true)
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({ type: 'Document', documentReference: 'documento-x' })
    expect(fetch.mock.calls[1]![0]).toBe('/accounts/conta-1/professional-verification')
    await act(async () => envio.resolve(new Response(null, { status: 204 })))
    await screen.findByText('Documento recebido. Sua conta aguarda a aprovação da equipe.')
  })

  it('cada pedido de atualização relê a verificação', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ status: 'InReview' })))
    montar()
    await screen.findByText('Documento recebido. Sua conta aguarda a aprovação da equipe.')
    for (const total of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar verificação' }))
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(total))
    }
  })

  it('cada nova tentativa depois de um erro relê a verificação', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ code: 'validation.invalid_field', params: { field: 'x' } }), { status: 400 }))
    montar()
    await screen.findByRole('alert')
    for (const total of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(total))
    }
  })

  it.each([
    ['uma aprovação', () => ativa()],
    ['um problema da API', () => new Response(JSON.stringify({ code: 'validation.invalid_field', params: { field: 'x' } }), { status: 400 })],
    ['um corpo malformado', () => new Response(JSON.stringify({ status: 'inventado' }))],
    ['uma falha de rede', () => new Error('rede caiu')],
  ])('%s tardio da sessão anterior não altera a tela atual', async (_nome, tardia) => {
    const antiga = deferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(antiga.promise).mockResolvedValue(new Response(JSON.stringify({ status: 'Pending' })))
    const view = render(pagina('token-antigo'))
    view.rerender(pagina('token-novo'))
    await screen.findByText('Verificação profissional')

    await act(async () => { const resposta = tardia(); if (resposta instanceof Error) antiga.reject(resposta); else antiga.resolve(resposta) })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Painel disponível')).toBeNull()
    expect(screen.getByText('Verificação profissional')).toBeTruthy()
  })

  it.each(['resolve', 'rejeita'])('as notas que %s tarde para a sessão anterior não substituem as da atual', async (como) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ativa())
    const antiga = deferred<Awaited<ReturnType<typeof carregarBiblioteca>>>()
    const atual = deferred<Awaited<ReturnType<typeof carregarBiblioteca>>>()
    vi.mocked(carregarBiblioteca).mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    const view = render(pagina('token-antigo'))
    await screen.findByText('Carregando notas pendentes...')
    view.rerender(pagina('token-novo'))
    await waitFor(() => expect(carregarBiblioteca).toHaveBeenCalledTimes(2))

    await act(async () => { if (como === 'resolve') antiga.resolve({ notas: [{ id: 'nota-antiga' } as Nota], nomesPacientes: new Map() }); else antiga.reject(new Error('tardia')) })
    expect(screen.getByTestId('painel-quantidade').textContent).toBe('0')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Carregando notas pendentes...')).toBeTruthy()

    await act(async () => atual.resolve({ notas: [{ id: 'nota-atual' } as Nota], nomesPacientes: new Map() }))
    expect(screen.getByTestId('painel-notas').textContent).toBe('nota-atual')
    expect(screen.queryByText('Carregando notas pendentes...')).toBeNull()
  })

  it('ao repetir a leitura das notas o painel começa sem notas e a carga some ao terminar', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ativa())
    vi.mocked(carregarBiblioteca).mockResolvedValueOnce({ notas: [{ id: 'nota-1' } as Nota], nomesPacientes: new Map() }).mockRejectedValueOnce(new Error('falha'))
    const view = montar()
    await waitFor(() => expect(screen.getByTestId('painel-quantidade').textContent).toBe('1'))
    expect(screen.queryByText('Carregando notas pendentes...')).toBeNull()
    view.rerender(pagina('token-novo'))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar as notas pendentes. Tente novamente.')
    expect(screen.getByTestId('painel-quantidade').textContent).toBe('0')

    const lenta = deferred<Awaited<ReturnType<typeof carregarBiblioteca>>>()
    vi.mocked(carregarBiblioteca).mockReturnValueOnce(lenta.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByTestId('painel-quantidade').textContent).toBe('0')
    expect(screen.getByText('Carregando notas pendentes...')).toBeTruthy()
    await act(async () => lenta.resolve({ notas: [{ id: 'nota-2' } as Nota], nomesPacientes: new Map() }))
    expect(screen.getByTestId('painel-notas').textContent).toBe('nota-2')
    expect(screen.queryByText('Carregando notas pendentes...')).toBeNull()
  })
})
