import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { abrirProntuario, type Prontuario } from './abrir-prontuario'
import { ProntuarioProvider } from './ProntuarioProvider'
import { useProntuario } from './prontuario-context'

vi.mock('./abrir-prontuario', () => ({ abrirProntuario: vi.fn() }))

const kek = {} as CryptoKey
const prontuario = (nome: string) => ({ nome }) as Prontuario
let recarregarAtual!: () => Promise<void>

function Consumidor() {
  const { prontuario: aberto, recarregar } = useProntuario()
  recarregarAtual = recarregar
  return <p>Pasta de {aberto.nome}</p>
}
function montar(accessToken = 'token', patientId = 'paciente') {
  return <I18nProvider i18n={i18n}><ProntuarioProvider baseUrl="" accountId="conta" accessToken={accessToken} kek={kek} patientId={patientId}><Consumidor /></ProntuarioProvider></I18nProvider>
}
function adiada() {
  let resolver!: (valor: Prontuario) => void
  let rejeitar!: (erro: unknown) => void
  const promessa = new Promise<Prontuario>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  return { promessa, resolver, rejeitar }
}

describe('ProntuarioProvider', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.mocked(abrirProntuario).mockReset() })

  it('mostra o carregamento e depois entrega o prontuário aberto a quem o consome', async () => {
    vi.mocked(abrirProntuario).mockResolvedValue(prontuario('Maria'))
    render(montar())
    expect(screen.getByRole('status').textContent).toBe('Abrindo prontuário...')
    expect(await screen.findByText('Pasta de Maria')).toBeTruthy()
    expect(abrirProntuario).toHaveBeenCalledWith('', 'conta', 'token', kek, 'paciente')
  })

  it('recarregar atualiza o prontuário sem desmontar os filhos e usa o token mais recente sem reabrir a pasta', async () => {
    vi.mocked(abrirProntuario).mockResolvedValueOnce(prontuario('Maria')).mockResolvedValueOnce(prontuario('Maria Souza'))
    const view = render(montar())
    await screen.findByText('Pasta de Maria')
    view.rerender(montar('token-renovado'))
    expect(abrirProntuario).toHaveBeenCalledOnce()
    await act(async () => recarregarAtual())
    expect(screen.getByText('Pasta de Maria Souza')).toBeTruthy()
    expect(abrirProntuario).toHaveBeenLastCalledWith('', 'conta', 'token-renovado', kek, 'paciente')
  })

  it('descarta a resposta de uma releitura mais antiga que termina depois da mais nova', async () => {
    vi.mocked(abrirProntuario).mockResolvedValueOnce(prontuario('Maria'))
    render(montar())
    await screen.findByText('Pasta de Maria')
    const antiga = adiada(), nova = adiada()
    vi.mocked(abrirProntuario).mockReturnValueOnce(antiga.promessa).mockReturnValueOnce(nova.promessa)
    let primeira!: Promise<void>, segunda!: Promise<void>
    act(() => { primeira = recarregarAtual(); segunda = recarregarAtual() })
    await act(async () => { nova.resolver(prontuario('Nova')); await segunda })
    await act(async () => { antiga.resolver(prontuario('Antiga')); await primeira })
    expect(screen.getByText('Pasta de Nova')).toBeTruthy()
  })

  it('devolve a falha da releitura a quem pediu e mantém a pasta aberta', async () => {
    vi.mocked(abrirProntuario).mockResolvedValueOnce(prontuario('Maria'))
    render(montar())
    await screen.findByText('Pasta de Maria')
    vi.mocked(abrirProntuario).mockRejectedValueOnce(new Error('rede caiu'))
    await act(async () => { await expect(recarregarAtual()).rejects.toThrow('rede caiu') })
    expect(screen.getByText('Pasta de Maria')).toBeTruthy()
  })

  it.each([new Error('A API recusou.'), 'sem objeto'])('mostra a falha da primeira leitura e tenta de novo: %s', async (falha) => {
    vi.mocked(abrirProntuario).mockRejectedValueOnce(falha).mockResolvedValueOnce(prontuario('Maria'))
    render(montar())
    expect((await screen.findByRole('alert')).textContent).toBe(falha instanceof Error ? falha.message : 'Não foi possível abrir o prontuário.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Pasta de Maria')).toBeTruthy()
  })

  it('volta a carregar ao trocar de paciente', async () => {
    vi.mocked(abrirProntuario).mockResolvedValueOnce(prontuario('Maria')).mockResolvedValueOnce(prontuario('João'))
    const view = render(montar())
    await screen.findByText('Pasta de Maria')
    view.rerender(montar('token', 'outro'))
    expect(await screen.findByText('Pasta de João')).toBeTruthy()
    expect(abrirProntuario).toHaveBeenLastCalledWith('', 'conta', 'token', kek, 'outro')
  })

  it('ao trocar de paciente esconde a pasta anterior enquanto abre a nova e ignora a resposta tardia da anterior', async () => {
    const nova = adiada()
    vi.mocked(abrirProntuario).mockResolvedValueOnce(prontuario('Maria'))
    const view = render(montar())
    await screen.findByText('Pasta de Maria')
    const antiga = adiada()
    vi.mocked(abrirProntuario).mockReturnValueOnce(antiga.promessa).mockReturnValueOnce(nova.promessa)
    act(() => { void recarregarAtual().catch(() => {}) })
    view.rerender(montar('token', 'outro'))
    expect(screen.getByRole('status').textContent).toBe('Abrindo prontuário...')
    expect(screen.queryByText('Pasta de Maria')).toBeNull()

    await act(async () => antiga.resolver(prontuario('Antiga')))
    expect(screen.queryByText('Pasta de Antiga')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()

    await act(async () => nova.resolver(prontuario('Nova')))
    expect(screen.getByText('Pasta de Nova')).toBeTruthy()
  })

  it('uma falha tardia da leitura anterior não derruba a pasta que está abrindo', async () => {
    const antiga = adiada()
    const nova = adiada()
    vi.mocked(abrirProntuario).mockReturnValueOnce(antiga.promessa).mockReturnValueOnce(nova.promessa)
    const view = render(montar())
    view.rerender(montar('token', 'outro'))

    await act(async () => antiga.rejeitar(new Error('tardia')))
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => nova.resolver(prontuario('Nova')))
    expect(screen.getByText('Pasta de Nova')).toBeTruthy()
  })

  it('cada nova tentativa depois de uma falha lê de novo', async () => {
    vi.mocked(abrirProntuario).mockRejectedValue(new Error('A API recusou.'))
    render(montar())
    await screen.findByRole('alert')
    for (const total of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
      await waitFor(() => expect(abrirProntuario).toHaveBeenCalledTimes(total))
      await screen.findByRole('alert')
    }
  })

  it.each(['resposta', 'falha'])('ignora a %s que chega depois de desmontar', async (tipo) => {
    const leitura = adiada()
    vi.mocked(abrirProntuario).mockReturnValueOnce(leitura.promessa)
    const view = render(montar())
    view.unmount()
    await act(async () => { if (tipo === 'resposta') leitura.resolver(prontuario('Tarde')); else leitura.rejeitar(new Error('tarde')) })
    expect(screen.queryByText('Pasta de Tarde')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('useProntuario exige o provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumidor />)).toThrow('useProntuario precisa de um <ProntuarioProvider> acima.')
    vi.restoreAllMocks()
  })
})
