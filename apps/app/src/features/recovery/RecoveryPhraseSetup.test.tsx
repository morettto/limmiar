import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as accountApi from '../../entities/account/api'
import * as keys from '../../entities/account/account-keys'
import * as crypto from '@limmiar/crypto'
import { deriveEmailSalt } from '../../entities/account/password-verifier'
import { deriveRecoveryVerifier } from '../../entities/account/recovery-verifier'
import { RecoveryPhraseSetup } from './RecoveryPhraseSetup'

vi.mock('../../entities/account/api', async () => ({
  ...await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api'),
  registerRecoveryPhrase: vi.fn(),
}))
vi.mock('../../entities/account/account-keys', async () => ({
  ...await vi.importActual<typeof import('../../entities/account/account-keys')>('../../entities/account/account-keys'),
  createRecoveryEnvelope: vi.fn(),
}))
vi.mock('@limmiar/crypto', async () => ({
  ...await vi.importActual<typeof import('@limmiar/crypto')>('@limmiar/crypto'), generateMnemonic: vi.fn(),
}))

const registerMock = vi.mocked(accountApi.registerRecoveryPhrase)
const sealMock = vi.mocked(keys.createRecoveryEnvelope)
const generateMock = vi.mocked(crypto.generateMnemonic)
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const EMAIL = 'pro@example.com'
const TOKEN = 'access-token-abc'
const ENVELOPE = new Uint8Array(120).fill(7)
const PHRASE = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always'
let kek: CryptoKey

function mount(onDone = vi.fn()) {
  generateMock.mockReturnValue(PHRASE)
  sealMock.mockResolvedValue(ENVELOPE)
  return render(<I18nProvider i18n={i18n}><RecoveryPhraseSetup baseUrl="http://api.test" accountId={ACCOUNT_ID} email={EMAIL} accessToken={TOKEN} kek={kek} onDone={onDone} /></I18nProvider>)
}
function generate() {
  fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'senha-atual' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gerar frase de recuperação' }))
}
async function save() {
  fireEvent.click(await screen.findByRole('button', { name: 'Guardei minha frase' }))
}

describe('RecoveryPhraseSetup', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
    kek = await webcrypto.importKek(new Uint8Array(32).fill(3))
  })
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it('só registra o verificador e a cifra depois de confirmar que a frase foi guardada', async () => {
    const onDone = vi.fn()
    registerMock.mockResolvedValue({ ok: true })
    mount(onDone)
    expect(registerMock).not.toHaveBeenCalled()
    generate()
    expect(screen.getByRole('status').textContent).toBe('Gerando sua frase de recuperação...')
    const items = await screen.findAllByRole('listitem')
    expect(generateMock).toHaveBeenCalledWith(256)
    expect(items.map((item) => item.textContent)).toEqual(PHRASE.split(' ').map((word, i) => `${i + 1}.${word}`))
    expect(registerMock).not.toHaveBeenCalled()
    expect(sealMock).toHaveBeenCalledWith('senha-atual', EMAIL, ACCOUNT_ID, PHRASE, kek)
    await save()
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    const expectedVerifier = await deriveRecoveryVerifier(PHRASE, await deriveEmailSalt(EMAIL))
    expect(registerMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, TOKEN, expectedVerifier, ENVELOPE)
    expect(new TextDecoder().decode(registerMock.mock.lastCall![3])).not.toContain('letter advice')
  }, 15000)

  it('abre com a senha vazia e sem aviso, e a lista de palavras não repete chaves', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount()
    expect((screen.getByLabelText('Senha atual') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    generate()
    await screen.findAllByRole('listitem')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(erro).not.toHaveBeenCalled()
    erro.mockRestore()
  }, 15000)

  it('recusa senha errada sem enviar nem exibir frase e permite tentar novamente', async () => {
    mount()
    sealMock.mockRejectedValueOnce(new Error('senha'))
    generate()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível proteger a chave. Verifique sua senha e tente novamente.')
    expect((screen.getByLabelText('Senha atual') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('list')).toBeNull()
    expect(registerMock).not.toHaveBeenCalled()
    generate()
    await screen.findByRole('list')
  }, 15000)

  it('mantém a mesma frase para repetir um registro que falhou', async () => {
    const onDone = vi.fn()
    mount(onDone)
    registerMock.mockResolvedValueOnce({ ok: false, code: 'auth.not_a_professional_account', params: {} }).mockResolvedValueOnce({ ok: true })
    generate()
    await save()
    expect((await screen.findByRole('alert')).textContent).toBe('Esta ação está disponível apenas para contas de profissional.')
    expect(onDone).not.toHaveBeenCalled()
    await save()
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(registerMock.mock.calls[1]).toEqual(registerMock.mock.calls[0])
    expect(generateMock).toHaveBeenCalledOnce()
  }, 15000)

  it.each([new Error('rede'), 'rede'])('permite repetir a gravação após falha de rede: %s', async (error) => {
    mount()
    registerMock.mockRejectedValueOnce(error)
    generate()
    await save()
    expect((await screen.findByRole('alert')).textContent).toBe(error instanceof Error ? 'rede' : 'Não foi possível conectar. Tente novamente.')
    expect((screen.getByRole('button', { name: 'Guardei minha frase' }) as HTMLButtonElement).disabled).toBe(false)
  }, 15000)

  it.each([false, true])('ignora conclusão da derivação depois de desmontar: falha=%s', async (failure) => {
    const { unmount } = mount()
    let resolve!: (value: Uint8Array<ArrayBuffer>) => void
    let reject!: (error: Error) => void
    sealMock.mockImplementationOnce(() => new Promise((a, b) => { resolve = a; reject = b }))
    generate()
    unmount()
    if (failure) reject(new Error('chave')); else resolve(ENVELOPE)
    await vi.waitFor(() => expect(sealMock).toHaveBeenCalledOnce())
    expect(registerMock).not.toHaveBeenCalled()
  }, 15000)

  it.each([false, true])('ignora conclusão do registro depois de desmontar: falha=%s', async (failure) => {
    const onDone = vi.fn()
    const { unmount } = mount(onDone)
    let resolve!: (value: { ok: true }) => void
    let reject!: (error: Error) => void
    registerMock.mockImplementationOnce(() => new Promise((a, b) => { resolve = a; reject = b }))
    generate()
    await save()
    expect((screen.getByRole('button', { name: 'Guardei minha frase' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    if (failure) reject(new Error('rede')); else resolve({ ok: true })
    await Promise.resolve()
    expect(onDone).not.toHaveBeenCalled()
  }, 15000)
})
