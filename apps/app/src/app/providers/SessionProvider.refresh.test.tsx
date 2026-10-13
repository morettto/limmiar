import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { webcrypto } from '@limmiar/crypto'
import type { Account } from '../../entities/account'
import type { ContextoSessao } from '../../entities/account/session-context'
import { useSession } from '../../entities/account/session-context'
import { SessionProvider } from './SessionProvider'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('../../entities/account', async () => ({
  ...await vi.importActual<typeof import('../../entities/account')>('../../entities/account'), refreshSession: refresh,
  logoutSession: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('./purgar-conta', () => ({ purgarConta: vi.fn() }))
let contexto: ContextoSessao
function Probe() { contexto = useSession(); return <p>{contexto.sessao?.accessToken}</p> }
function conta(): Account {
  return { id: 'conta', email: 'conta@exemplo.local', role: 'Professional', twoFactorRequirement: 'ChallengeRequired', twoFactorTicket: null,
    accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: new Date(Date.now() + 60100).toISOString() }
}
const tokens = { accessToken: 'novo-access', refreshToken: 'novo-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }
function montar(account = conta()) {
  window.sessionStorage.setItem('limmiar:account', JSON.stringify(account))
  return render(<SessionProvider><Probe /></SessionProvider>)
}
describe('renovação da sessão', () => {
  beforeEach(() => { vi.useFakeTimers(); refresh.mockReset(); window.sessionStorage.clear() })
  afterEach(() => { cleanup(); vi.useRealTimers(); window.sessionStorage.clear() })
  it('renova tokens sem substituir a chave de criptografia em memória', async () => {
    refresh.mockResolvedValue({ ok: true, ...tokens })
    montar()
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(7))
    act(() => contexto.iniciarSessao(conta(), kek))
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(refresh).toHaveBeenCalledWith('', 'refresh')
    expect(contexto.sessao?.accessToken).toBe(tokens.accessToken)
    expect(contexto.kek).toBe(kek)
    expect(JSON.parse(window.sessionStorage.getItem('limmiar:account')!)).not.toHaveProperty('ok')
    expect(JSON.parse(window.sessionStorage.getItem('limmiar:account')!)).not.toHaveProperty('kek')
  })
  it.each(['rede', 'servidor'])('mantém a sessão durante falha de %s e tenta novamente', async (falha) => {
    if (falha === 'rede') refresh.mockRejectedValueOnce(new Error('sem rede'))
    else refresh.mockResolvedValueOnce({ ok: false, code: 'server.unavailable', params: {} })
    refresh.mockResolvedValue({ ok: true, ...tokens })
    montar()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(contexto.sessao?.accessToken).toBe('access')
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(contexto.sessao?.accessToken).toBe(tokens.accessToken)
  })
  it('encerra uma família de sessão inválida e ignora uma resposta depois de desmontar', async () => {
    refresh.mockResolvedValueOnce({ ok: false, code: 'auth.refresh_token_invalid', params: {} })
    const view = montar()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(contexto.sessao).toBeNull()
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
    view.unmount()
    let resolver!: (value: unknown) => void
    refresh.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve }))
    const outro = montar()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    outro.unmount()
    await act(async () => { resolver({ ok: true, ...tokens }) })
    expect(JSON.parse(window.sessionStorage.getItem('limmiar:account')!).accessToken).toBe('access')
  })
  it('recusa uma KEK extraível', async () => {
    montar()
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    expect(() => contexto.iniciarSessao(conta(), key)).toThrow('non-extractable')
  })

  it('ignora uma falha de rede recebida após desmontar, sem agendar nova tentativa', async () => {
    let rejeitar!: (error: Error) => void
    refresh.mockReturnValueOnce(new Promise((_resolve, reject) => { rejeitar = reject }))
    const view = montar()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    view.unmount()
    await act(async () => { rejeitar(new Error('rede')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(refresh).toHaveBeenCalledOnce()
  })
})
