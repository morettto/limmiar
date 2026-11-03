import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { registerRecoveryPhrase } from '../../entities/account/api'
import { RecoveryPhraseSetup } from './RecoveryPhraseSetup'

vi.mock('../../entities/account/api', async () => ({
  ...await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api'),
  registerRecoveryPhrase: vi.fn(),
}))
function mount(onDone = vi.fn()) {
  return render(<I18nProvider i18n={i18n}><RecoveryPhraseSetup baseUrl="" accountId="account" email="pro@example.com" accessToken="token" onDone={onDone} /></I18nProvider>)
}
beforeAll(() => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('recuperação somente do login', () => {
  it('não solicita chave clínica; só envia o verificador após guardar a frase', async () => {
    vi.mocked(registerRecoveryPhrase).mockResolvedValue({ ok: true })
    const done = vi.fn()
    mount(done)
    expect(screen.getByText(/não substitui a chave pessoal/)).toBeTruthy()
    expect(screen.queryByLabelText('Senha atual')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar frase de recuperação' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(24)
    expect(registerRecoveryPhrase).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Guardei minha frase' }))
    await waitFor(() => expect(done).toHaveBeenCalledOnce(), { timeout: 10000 })
    expect(vi.mocked(registerRecoveryPhrase).mock.calls[0]).toHaveLength(4)
    expect(screen.queryByRole('list')).toBeNull()
  }, 15000)

  it('preserva a frase e permite tentar novamente após falha de rede', async () => {
    vi.mocked(registerRecoveryPhrase).mockRejectedValue(new Error('network'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar frase de recuperação' }))
    const phrase = screen.getByRole('list').textContent
    fireEvent.click(screen.getByRole('button', { name: 'Guardei minha frase' }))
    await screen.findByRole('alert', {}, { timeout: 10000 })
    expect(screen.getByRole('list').textContent).toBe(phrase)
  }, 15000)
})
