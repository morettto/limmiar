import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as accountApi from '../../entities/account/api'
import type { Account } from '../../entities/account'
import { AuthScreen } from './AuthScreen'

const kekDerivada = vi.hoisted(() => ({ chave: { extractable: false } as unknown as CryptoKey }))
vi.mock('../../entities/account/api', async () => ({
  ...await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api'),
  register: vi.fn(), login: vi.fn(), continueWithGoogle: vi.fn(),
}))
vi.mock('../../entities/account/password-verifier', () => ({
  deriveEmailSalt: vi.fn(async () => new Uint8Array(16).fill(1)),
  deriveEmailPasswordVerifier: vi.fn(async () => new Uint8Array(32).fill(2)),
}))
vi.mock('../../entities/account/account-keys', () => ({
  deriveAccountKek: vi.fn(async () => kekDerivada.chave),
  createRecoveryEnvelope: vi.fn(), openRecoveryEnvelope: vi.fn(),
}))
vi.mock('../../features/magic-link-auth/MagicLinkCallback', () => ({
  MagicLinkCallback: ({ token }: { token: string }) => <p data-token={token}>Confirmação</p>,
}))

const conta = (sobrescrever: Partial<Account> = {}) => ({
  id: 'conta-1', email: 'pro@example.com', role: 'Professional' as const, twoFactorRequirement: 'NotApplicable' as const, twoFactorTicket: null,
  accessToken: 'acesso', refreshToken: 'renovacao', accessTokenExpiresAt: '2099-01-01T00:00:00Z', ...sobrescrever,
})
function tela(props: Partial<React.ComponentProps<typeof AuthScreen>> = {}) {
  return render(<I18nProvider i18n={i18n}><AuthScreen baseUrl="http://api.test" getGoogleIdToken={async () => 'google'} {...props} /></I18nProvider>)
}
const preencher = (email = 'pro@example.com', senha = 'senha-longa') => {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } })
}

describe('AuthScreen: estados e textos', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  beforeEach(() => { vi.mocked(accountApi.register).mockReset(); vi.mocked(accountApi.login).mockReset(); vi.mocked(accountApi.continueWithGoogle).mockReset() })
  afterEach(cleanup)

  it('abre em cadastro profissional, com campos vazios, sem aviso e com os rótulos certos', () => {
    tela()
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Senha')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Senha').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByRole('button', { name: 'Cadastrar' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Entrar' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('radiogroup', { name: 'Tipo de conta' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('o paciente não vê Entrar nem Cadastrar e começa com o código vazio', () => {
    tela()
    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))
    expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cadastrar' })).toBeNull()
    expect(screen.getByLabelText('Código de acesso recebido do profissional')).toHaveProperty('value', '')
  })

  it('alternar entre entrar e cadastrar troca os rótulos, a dica de senha e limpa o aviso anterior', async () => {
    vi.mocked(accountApi.register).mockResolvedValue({ ok: false, code: 'auth.email_already_registered', params: {} })
    tela(); preencher()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Entrar' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Cadastrar' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Acessar conta' })).toBeTruthy()
    expect(screen.getByLabelText('Senha').getAttribute('autocomplete')).toBe('current-password')
    vi.mocked(accountApi.login).mockResolvedValue({ ok: false, code: 'auth.invalid_credentials', params: {} })
    fireEvent.click(screen.getByRole('button', { name: 'Acessar conta' }))
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha inválidos.')
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Criar conta' })).toBeTruthy()
    expect(vi.mocked(accountApi.login).mock.calls[0]![1]).toEqual({ email: 'pro@example.com', passwordVerifier: new Uint8Array(32).fill(2) })
  })

  it('enquanto envia, bloqueia todos os botões e depois mostra o sucesso uma única vez', async () => {
    const envio = deferred<accountApi.RegisterResult>()
    vi.mocked(accountApi.register).mockReturnValue(envio.promise)
    const onAuthenticated = vi.fn()
    tela({ onAuthenticated }); preencher()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar conta' })).toHaveProperty('disabled', true))
    for (const nome of ['Entrar', 'Cadastrar', 'Continuar com o Google']) expect(screen.getByRole('button', { name: nome })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('status')).toBeNull()
    await act(async () => envio.resolve({ ok: true, account: conta() }))
    expect((await screen.findByRole('status')).textContent).toBe('Conta criada. Você está cadastrado como profissional.')
    expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith(conta(), kekDerivada.chave)
    expect(screen.getByLabelText('Senha')).toHaveProperty('value', '')
  })

  it('o Google também bloqueia os botões enquanto espera e entrega só a conta, sem chave', async () => {
    const envio = deferred<accountApi.GoogleAuthResult>()
    vi.mocked(accountApi.continueWithGoogle).mockReturnValue(envio.promise)
    const onAuthenticated = vi.fn()
    tela({ onAuthenticated })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Criar conta' })).toHaveProperty('disabled', true))
    await act(async () => envio.resolve({ ok: true, isNewAccount: false, account: conta() }))
    await screen.findByRole('status')
    expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith(conta())
  })

  it('autentica sem ninguém ouvindo, com ou sem chave', async () => {
    vi.mocked(accountApi.continueWithGoogle).mockResolvedValue({ ok: true, isNewAccount: false, account: conta() })
    vi.mocked(accountApi.register).mockResolvedValue({ ok: true, account: conta() })
    tela()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))
    expect((await screen.findByRole('status')).textContent).toContain('Conta criada')
    cleanup()
    tela(); preencher()
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect((await screen.findByRole('status')).textContent).toContain('Conta criada')
  })

  it('recusa uma resposta de conta que não é profissional, com a mensagem de erro inesperado', async () => {
    const onAuthenticated = vi.fn()
    vi.mocked(accountApi.continueWithGoogle).mockResolvedValue({ ok: true, isNewAccount: false, account: conta({ role: 'Patient' }) })
    tela({ onAuthenticated })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Ocorreu um erro inesperado no servidor.')
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('o código do paciente vai aparado e em maiúsculas para a confirmação', () => {
    tela()
    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))
    fireEvent.change(screen.getByLabelText('Código de acesso recebido do profissional'), { target: { value: '  ab12cd34ef  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar com meu código' }))
    expect(screen.getByText('Confirmação').getAttribute('data-token')).toBe('AB12CD34EF')
  })
})
