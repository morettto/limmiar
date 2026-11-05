import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { createVault } from '../../entities/clinical-vault/crypto'
import { getVault, saveVault } from '../../entities/clinical-vault/api'
import { VaultScreen } from './ClinicalVaultGate'

vi.mock('../../entities/clinical-vault/api', () => ({ getVault: vi.fn(), saveVault: vi.fn() }))
const account = { baseUrl: '', accountId: '11111111-1111-4111-8111-111111111111', accessToken: 'test-token' }
beforeAll(() => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })

function mount(onUnlocked = vi.fn()) {
  function Host() {
    const [key, setKey] = useState<CryptoKey | null>(null)
    return key ? <p>Consultório aberto</p> : <VaultScreen account={account} onExit={vi.fn()} onUnlocked={key => { setKey(key); onUnlocked(key) }} />
  }
  return render(<I18nProvider i18n={i18n}><Host /></I18nProvider>)
}

function confirm(key: string) {
  fireEvent.change(screen.getByLabelText('Últimos 6 caracteres da chave pessoal'), { target: { value: key.slice(-6) } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Concluir e abrir consultório' }))
}

describe('tela única de chave e recuperação', () => {
  it('copia o kit só por ação explícita e mantém os segredos se a cópia falhar', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.mocked(getVault).mockResolvedValue(null)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar minha chave pessoal' }))
    const key = (await screen.findByText(/^lm-key-1\./)).textContent!
    expect(writeText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar kit de acesso' }))
    await screen.findByRole('alert')
    expect(screen.getByText(key)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar kit de acesso' }))
    await screen.findByRole('status')
    expect(writeText.mock.lastCall![0]).toContain(key)
    expect(writeText.mock.lastCall![0]).toContain('Sem a chave e sem os códigos')
    expect(saveVault).not.toHaveBeenCalled()
  })
  it('só salva após guardar e confirmar; não permite revelar a chave depois', async () => {
    vi.mocked(getVault).mockResolvedValue(null)
    vi.mocked(saveVault).mockResolvedValue()
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar minha chave pessoal' }))
    await screen.findByRole('heading', { name: 'Guarde seu acesso agora' })
    const key = screen.getByText(/^lm-key-1\./).textContent!
    expect(screen.getAllByText(/^lm-recovery-1\./)).toHaveLength(3)
    expect(saveVault).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Concluir e abrir consultório' }) as HTMLButtonElement).disabled).toBe(true)
    confirm(key)
    await screen.findByText('Consultório aberto')
    expect(screen.queryByText(key)).toBeNull()
    expect(saveVault).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(saveVault).mock.calls)).not.toContain(key)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('não gera nova chave quando o servidor falha', async () => {
    vi.mocked(getVault).mockRejectedValue(new Error('network'))
    mount()
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Gerar minha chave pessoal' })).toBeNull()
    expect(saveVault).not.toHaveBeenCalled()
  })

  it('recusa chave errada, limpa a entrada e abre somente com a chave correta', async () => {
    const existing = await createVault(account.accountId)
    vi.mocked(getVault).mockResolvedValue(existing.document)
    const unlocked = vi.fn()
    mount(unlocked)
    const input = await screen.findByLabelText('Chave pessoal')
    fireEvent.change(input, { target: { value: 'senha-de-login' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear prontuários' }))
    await screen.findByRole('alert')
    expect((input as HTMLInputElement).value).toBe('')
    expect(unlocked).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: existing.key } })
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear prontuários' }))
    await screen.findByText('Consultório aberto')
    expect(unlocked.mock.calls[0]![0].extractable).toBe(false)
  })

  it('recuperação exige código e confirmação dos novos segredos antes de salvar', async () => {
    const existing = await createVault(account.accountId)
    vi.mocked(getVault).mockResolvedValue(existing.document)
    vi.mocked(saveVault).mockResolvedValue()
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Perdi minha chave pessoal' }))
    fireEvent.change(screen.getByLabelText('Código de recuperação'), { target: { value: existing.recoveryCodes[0] } })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar nova chave' }))
    const key = (await screen.findByText(/^lm-key-1\./)).textContent!
    expect(key).not.toBe(existing.key)
    expect(saveVault).not.toHaveBeenCalled()
    confirm(key)
    await screen.findByText('Consultório aberto')
    expect(saveVault).toHaveBeenCalledWith(account, expect.any(Object), {
      expectedRevision: existing.document.revision, recoveryId: existing.document.recoverySlots[0]!.id,
      recoveryVerifier: existing.document.recoverySlots[0]!.verifier,
    })
  })

  it('preserva o kit após falha ao salvar e evita submissão duplicada', async () => {
    vi.mocked(getVault).mockResolvedValue(null)
    vi.mocked(saveVault).mockRejectedValue(new Error('network'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar minha chave pessoal' }))
    const key = (await screen.findByText(/^lm-key-1\./)).textContent!
    confirm(key)
    await screen.findByRole('alert')
    expect(screen.getByText(key)).toBeTruthy()
    vi.mocked(saveVault).mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir e abrir consultório' }))
    await waitFor(() => expect(saveVault).toHaveBeenCalledTimes(2))
    await screen.findByText('Consultório aberto')
  })
})
