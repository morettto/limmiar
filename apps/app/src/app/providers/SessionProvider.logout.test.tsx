import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import type { Account } from '../../entities/account'
import { useSession, type ContextoSessao } from '../../entities/account/session-context'
import { SessionProvider } from './SessionProvider'

const mocks = vi.hoisted(() => ({ logout: vi.fn(), purge: vi.fn(), refresh: vi.fn() }))
vi.mock('../../entities/account', async () => ({
  ...await vi.importActual<typeof import('../../entities/account')>('../../entities/account'),
  logoutSession: mocks.logout, refreshSession: mocks.refresh,
}))
vi.mock('./purgar-conta', () => ({ purgarConta: mocks.purge }))
let contexto: ContextoSessao
function Probe() { contexto = useSession(); return <p>{contexto.sessao?.id ?? 'sem sessão'}</p> }
const conta = (id = 'a', refreshToken: string | null = `refresh-${id}`): Account => ({
  id, refreshToken, email: `${id}@exemplo.local`, role: 'Professional', twoFactorTicket: null,
  twoFactorRequirement: 'NotApplicable', accessToken: `access-${id}`, accessTokenExpiresAt: '2099-01-01T00:00:00Z',
})
function montar() { return render(<I18nProvider i18n={i18n}><SessionProvider><Probe /></SessionProvider></I18nProvider>) }

describe('saída local e revogação no servidor', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  beforeEach(() => { window.sessionStorage.clear(); mocks.logout.mockReset(); mocks.logout.mockResolvedValue({ ok: true }); mocks.purge.mockReset(); mocks.refresh.mockReset() })
  afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.useRealTimers() })

  it('retira KEK, conta e caches imediatamente, mesmo com a revogação ainda em voo', async () => {
    let concluir!: (value: unknown) => void
    mocks.logout.mockReturnValueOnce(new Promise((resolve) => { concluir = resolve }))
    montar()
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(7))
    act(() => contexto.iniciarSessao(conta('a', 'refresh-mais-recente'), kek))
    act(() => { contexto.terminarSessao(); contexto.terminarSessao() })
    expect(contexto.sessao).toBeNull()
    expect(contexto.kek).toBeNull()
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
    expect(mocks.purge).toHaveBeenCalledWith('a')
    expect(mocks.logout).toHaveBeenCalledExactlyOnceWith('', 'refresh-mais-recente')
    await act(async () => { concluir({ ok: true }) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['rede', 'servidor'])('expõe falha de %s e permite repetir a revogação sem restaurar as chaves', async (falha) => {
    if (falha === 'rede') mocks.logout.mockRejectedValueOnce(new Error('sem rede'))
    else mocks.logout.mockResolvedValueOnce({ ok: false, code: 'server.unavailable' })
    montar()
    act(() => contexto.iniciarSessao(conta()))
    await act(async () => { contexto.terminarSessao() })
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível encerrar a sessão no servidor.')
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tentar encerrar no servidor novamente' })) })
    expect(mocks.logout).toHaveBeenNthCalledWith(2, '', 'refresh-a')
    expect(contexto.kek).toBeNull()
    expect(contexto.sessao).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('revoga a conta anterior na troca e preserva a nova sessão e sua KEK', async () => {
    montar()
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(3))
    act(() => contexto.iniciarSessao(conta('a')))
    await act(async () => { contexto.iniciarSessao(conta('b'), kek) })
    expect(mocks.logout).toHaveBeenCalledExactlyOnceWith('', 'refresh-a')
    expect(mocks.purge).toHaveBeenCalledWith('a')
    expect(contexto.sessao?.id).toBe('b')
    expect(contexto.kek).toBe(kek)
  })

  it('mantém todas as revogações pendentes até a última confirmação', async () => {
    mocks.logout.mockRejectedValueOnce(new Error('rede')).mockRejectedValueOnce(new Error('rede'))
    montar()
    act(() => contexto.iniciarSessao(conta('a')))
    await act(async () => { contexto.iniciarSessao(conta('b')) })
    await act(async () => { contexto.terminarSessao() })
    let concluirB!: (value: unknown) => void
    mocks.logout.mockResolvedValueOnce({ ok: true }).mockReturnValueOnce(new Promise((resolve) => { concluirB = resolve }))
    await act(async () => { fireEvent.click(screen.getByRole('button')) })
    expect(mocks.logout).toHaveBeenNthCalledWith(3, '', 'refresh-a')
    expect(mocks.logout).toHaveBeenNthCalledWith(4, '', 'refresh-b')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { concluirB({ ok: true }) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('recusa autenticação incompleta antes de purgar ou revogar a conta atual', async () => {
    montar()
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(9))
    act(() => contexto.iniciarSessao(conta('a'), kek))
    expect(() => contexto.iniciarSessao(conta('b', null))).toThrow('incomplete authentication')
    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.purge).not.toHaveBeenCalled()
    expect(contexto.sessao?.id).toBe('a')
    expect(contexto.kek).toBe(kek)
  })

  it('descarta renovação concluída depois da saída e revoga a família usando o token anterior', async () => {
    vi.useFakeTimers()
    let concluir!: (value: unknown) => void
    mocks.refresh.mockReturnValueOnce(new Promise((resolve) => { concluir = resolve }))
    montar()
    act(() => contexto.iniciarSessao({ ...conta(), accessTokenExpiresAt: new Date(Date.now() + 60100).toISOString() }))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await act(async () => { contexto.terminarSessao() })
    await act(async () => { concluir({ ok: true, accessToken: 'novo-access', refreshToken: 'novo-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }) })
    expect(contexto.sessao).toBeNull()
    expect(mocks.logout).toHaveBeenCalledExactlyOnceWith('', 'refresh-a')
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
  })
})
