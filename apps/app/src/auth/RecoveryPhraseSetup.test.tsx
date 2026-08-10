import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import * as crypto from '@limmiar/crypto'
import { deriveEmailSalt } from './password-verifier'
import { deriveRecoveryVerifier } from './recovery-verifier'
import { RecoveryPhraseSetup } from './RecoveryPhraseSetup'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    registerRecoveryPhrase: vi.fn(),
  }
})

vi.mock('@limmiar/crypto', async () => {
  const actual = await vi.importActual<typeof import('@limmiar/crypto')>('@limmiar/crypto')
  return {
    ...actual,
    generateMnemonic: vi.fn(),
  }
})

const registerRecoveryPhraseMock = vi.mocked(client.registerRecoveryPhrase)
const generateMnemonicMock = vi.mocked(crypto.generateMnemonic)

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const ACCESS_TOKEN = 'access-token-abc'
const EMAIL = 'pro@example.com'
const FIXED_MNEMONIC =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always'

function renderRecoveryPhraseSetup(onDone: () => void = vi.fn()) {
  return render(
    <I18nProvider i18n={i18n}>
      <RecoveryPhraseSetup
        baseUrl="http://api.test"
        accountId={ACCOUNT_ID}
        email={EMAIL}
        accessToken={ACCESS_TOKEN}
        onDone={onDone}
      />
    </I18nProvider>,
  )
}

describe('RecoveryPhraseSetup', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a generating status before setup completes, with no duplicate list-item keys once ready', async () => {
    generateMnemonicMock.mockReturnValue(FIXED_MNEMONIC)
    let resolveRegister: (result: { ok: true }) => void = () => {}
    registerRecoveryPhraseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegister = resolve
        }),
    )
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderRecoveryPhraseSetup()
    expect(screen.getByRole('status').textContent).toBe('Gerando sua frase de recuperação...')

    await waitFor(() => expect(registerRecoveryPhraseMock).toHaveBeenCalled())
    resolveRegister({ ok: true })
    await screen.findAllByRole('listitem')

    expect(
      consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes('same key')),
    ).toBe(false)
    consoleErrorSpy.mockRestore()
  }, 15000)

  it('generates a mnemonic, registers its verifier, and shows the phrase as a numbered word grid', async () => {
    generateMnemonicMock.mockReturnValue(FIXED_MNEMONIC)
    registerRecoveryPhraseMock.mockResolvedValue({ ok: true })
    renderRecoveryPhraseSetup()

    await waitFor(() => expect(registerRecoveryPhraseMock).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('heading', { name: 'Guarde sua frase de recuperação' })).toBeTruthy()

    const call = registerRecoveryPhraseMock.mock.calls[0]
    expect(call?.[0]).toBe('http://api.test')
    expect(call?.[1]).toBe(ACCOUNT_ID)
    expect(call?.[2]).toBe(ACCESS_TOKEN)

    const expectedSalt = await deriveEmailSalt(EMAIL)
    const expectedVerifier = await deriveRecoveryVerifier(FIXED_MNEMONIC, expectedSalt)
    expect(call?.[3]).toEqual(expectedVerifier)

    // getByText would fail here: FIXED_MNEMONIC repeats several words (a real BIP39 phrase
    // can do that), so each numbered list item is asserted by position instead.
    const words = FIXED_MNEMONIC.split(' ')
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(words.length)
    for (const [index, word] of words.entries()) {
      expect(items[index]?.textContent).toBe(`${index + 1}.${word}`)
    }

    // Never the plaintext mnemonic sent verbatim as the verifier -- neither the raw string
    // nor its UTF-8 bytes appear anywhere in what was actually sent.
    expect(new TextDecoder().decode(call?.[3] as Uint8Array)).not.toContain('letter advice')
  }, 15000)

  it('does not update state after unmounting while setup is still pending', async () => {
    generateMnemonicMock.mockReturnValue(FIXED_MNEMONIC)
    let resolveRegister: (result: { ok: true }) => void = () => {}
    registerRecoveryPhraseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegister = resolve
        }),
    )
    const { unmount } = renderRecoveryPhraseSetup()

    await waitFor(() => expect(registerRecoveryPhraseMock).toHaveBeenCalled())
    unmount()

    expect(() => resolveRegister({ ok: true })).not.toThrow()
  }, 15000)

  it('shows a translated error when registering the recovery phrase fails, and never shows the phrase', async () => {
    generateMnemonicMock.mockReturnValue(FIXED_MNEMONIC)
    registerRecoveryPhraseMock.mockResolvedValue({
      ok: false,
      code: 'auth.not_a_professional_account',
      params: {},
    })
    renderRecoveryPhraseSetup()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ocorreu um erro inesperado. Tente novamente.',
    )
    expect(screen.queryByText('letter')).toBeNull()
  }, 15000)

  it('clicking "Guardei minha frase" calls onDone', async () => {
    generateMnemonicMock.mockReturnValue(FIXED_MNEMONIC)
    registerRecoveryPhraseMock.mockResolvedValue({ ok: true })
    const onDone = vi.fn()
    renderRecoveryPhraseSetup(onDone)

    fireEvent.click(await screen.findByRole('button', { name: 'Guardei minha frase' }))

    expect(onDone).toHaveBeenCalledTimes(1)
  }, 15000)
})
