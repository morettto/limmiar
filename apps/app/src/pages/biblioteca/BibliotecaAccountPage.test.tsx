import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { carregarBiblioteca } from '../../features/nota-biblioteca/carregar-biblioteca'
import { FakeDirectoryHandle, stubOpfsRoot } from '../../test-support/fake-opfs'
import { BibliotecaAccountPage } from './BibliotecaAccountPage'
import { BibliotecaPage, type BibliotecaPageProps } from './BibliotecaPage'

vi.mock('../../features/nota-biblioteca/carregar-biblioteca', () => ({ carregarBiblioteca: vi.fn() }))
vi.mock('./BibliotecaPage', () => ({ BibliotecaPage: vi.fn(({ nomesPacientes }: BibliotecaPageProps) => <div data-testid="biblioteca-pronta">{[...nomesPacientes.values()].join(', ')}</div>) }))
const carregar = vi.mocked(carregarBiblioteca)
const dados = { notas: [], nomesPacientes: new Map([['paciente', 'Nome sintético da conta']]) }
const kek = await webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
const props = { baseUrl: '', accountId: 'conta', accessToken: 'token', kek }
let raiz: FakeDirectoryHandle
let restaurar: () => void
function view(atual = props) { return <I18nProvider i18n={i18n}><BibliotecaAccountPage {...atual} /></I18nProvider> }
function pendente<T>() {
  let resolve!: (value: T) => void
  let reject!: (erro: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
beforeAll(async () => dynamicActivate('pt-BR'))
beforeEach(() => {
  carregar.mockReset().mockResolvedValue(dados)
  vi.mocked(BibliotecaPage).mockClear()
  raiz = new FakeDirectoryHandle()
  restaurar = stubOpfsRoot(raiz)
})
afterEach(() => { cleanup(); restaurar(); vi.restoreAllMocks() })

describe('biblioteca da conta autenticada', () => {
  it('carrega dados reais e usa diretório e chave exclusivos da conta', async () => {
    render(view())
    expect(screen.getByRole('status').textContent).toMatch('Carregando notas')
    await screen.findByTestId('biblioteca-pronta')
    expect(carregar).toHaveBeenCalledWith('', 'conta', 'token', kek)
    expect(raiz.dirs.has('conta')).toBe(true)
    const biblioteca = vi.mocked(BibliotecaPage).mock.calls.at(-1)![0]
    expect(biblioteca.chaveIndice).toBe(kek)
    await biblioteca.store.gravar(new Uint8Array([1, 2, 3]))
    expect(raiz.dirs.get('conta')!.files.get('indice-busca')!.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
  it('mostra erro recuperável quando o carregamento falha', async () => {
    carregar.mockRejectedValueOnce(new Error('rede indisponível'))
    render(view())
    await screen.findByRole('alert')
    expect(screen.queryByTestId('biblioteca-pronta')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await screen.findByTestId('biblioteca-pronta')
    expect(carregar).toHaveBeenCalledTimes(2)
  })
  it('não exibe a biblioteca anterior durante troca de conta ou de chave', async () => {
    const mounted = render(view())
    await screen.findByTestId('biblioteca-pronta')
    const atraso = pendente<typeof dados>()
    carregar.mockReturnValueOnce(atraso.promise)
    mounted.rerender(view({ ...props, accountId: 'outra' }))
    expect(screen.queryByTestId('biblioteca-pronta')).toBeNull()
    await act(async () => atraso.resolve({ ...dados, nomesPacientes: new Map([['outro', 'Outra conta']]) }))
    expect(screen.getByTestId('biblioteca-pronta').textContent).toBe('Outra conta')
    const outraKek = await webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    const chavePendente = pendente<typeof dados>()
    carregar.mockReturnValueOnce(chavePendente.promise)
    mounted.rerender(view({ ...props, accountId: 'outra', kek: outraKek }))
    expect(screen.queryByTestId('biblioteca-pronta')).toBeNull()
    await act(async () => chavePendente.resolve(dados))
    expect(vi.mocked(BibliotecaPage).mock.calls.at(-1)![0].chaveIndice).toBe(outraKek)
  })
  it.each(['resolve', 'reject'])('descarta carregamento após sair da página: %s', async (modo) => {
    const atraso = pendente<typeof dados>()
    carregar.mockReturnValueOnce(atraso.promise)
    const mounted = render(view())
    mounted.unmount()
    await act(async () => { if (modo === 'resolve') atraso.resolve(dados); else atraso.reject(new Error('antigo')) })
    expect(raiz.dirs.size).toBe(0)
    expect(BibliotecaPage).not.toHaveBeenCalled()
  })
  it('descarta OPFS atrasada quando a página foi encerrada', async () => {
    const atraso = pendente<FakeDirectoryHandle>()
    vi.spyOn(raiz, 'getDirectoryHandle').mockReturnValueOnce(atraso.promise)
    const mounted = render(view())
    await waitFor(() => expect(raiz.getDirectoryHandle).toHaveBeenCalled())
    mounted.unmount()
    await act(async () => atraso.resolve(new FakeDirectoryHandle()))
    expect(BibliotecaPage).not.toHaveBeenCalled()
  })

  it('na primeira renderização mostra o carregamento, não o erro', () => {
    const html = renderToString(view())
    expect(html).toContain('Carregando notas do prontuário...')
    expect(html).not.toContain('role="alert"')
  })

  it('o erro tem o texto próprio e cada nova tentativa carrega de novo', async () => {
    carregar.mockRejectedValue(new Error('rede indisponível'))
    render(view())
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível carregar a biblioteca. Tente novamente.')
    for (const total of [2, 3, 4]) {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
      await waitFor(() => expect(carregar).toHaveBeenCalledTimes(total))
      await screen.findByRole('alert')
    }
  })

  it('nunca desenha a biblioteca da conta ou da chave anteriores nem por um instante', async () => {
    const mounted = render(view())
    await screen.findByTestId('biblioteca-pronta')
    const outraKek = await webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    carregar.mockReturnValue(pendente<typeof dados>().promise)
    vi.mocked(BibliotecaPage).mockClear()
    mounted.rerender(view({ ...props, kek: outraKek }))
    expect(BibliotecaPage).not.toHaveBeenCalled()
    mounted.rerender(view({ ...props, accountId: 'outra', kek: outraKek }))
    expect(BibliotecaPage).not.toHaveBeenCalled()
  })

  it('o diretório atrasado de uma conta anterior não derruba a biblioteca da atual', async () => {
    const atraso = pendente<FakeDirectoryHandle>()
    vi.spyOn(raiz, 'getDirectoryHandle').mockReturnValueOnce(atraso.promise)
    const mounted = render(view())
    await waitFor(() => expect(raiz.getDirectoryHandle).toHaveBeenCalledTimes(1))
    mounted.rerender(view({ ...props, accountId: 'outra' }))
    await screen.findByTestId('biblioteca-pronta')

    await act(async () => atraso.resolve(new FakeDirectoryHandle()))

    expect(screen.getByTestId('biblioteca-pronta')).toBeTruthy()
  })

  it('uma falha tardia de uma conta anterior não acende o erro enquanto a atual carrega', async () => {
    const antiga = pendente<typeof dados>()
    const atual = pendente<typeof dados>()
    carregar.mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    const mounted = render(view())
    mounted.rerender(view({ ...props, accountId: 'outra' }))

    await act(async () => antiga.reject(new Error('tardia')))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => atual.resolve(dados))
    expect(screen.getByTestId('biblioteca-pronta')).toBeTruthy()
  })
})
