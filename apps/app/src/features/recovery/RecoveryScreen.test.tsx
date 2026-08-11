import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as accountApi from '../../entities/account/api'
import { deriveEmailSalt } from '../../entities/account/password-verifier'
import { deriveRecoveryVerifier } from '../../entities/account/recovery-verifier'
import { RecoveryScreen } from './RecoveryScreen'

vi.mock('../../entities/account/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api')
  return {
    ...actual,
    recoverAccess: vi.fn(),
    verifyTotpChallenge: vi.fn(),
    beginTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
  }
})

const recoverAccessMock = vi.mocked(accountApi.recoverAccess)
const verifyTotpChallengeMock = vi.mocked(accountApi.verifyTotpChallenge)
const beginTotpEnrollmentMock = vi.mocked(accountApi.beginTotpEnrollment)
const confirmTotpEnrollmentMock = vi.mocked(accountApi.confirmTotpEnrollment)

// Trezor vectors.json known-answer 24-word mnemonic (also used in packages/crypto's own
// bip39.test.ts) -- a real, checksum-valid BIP39 phrase, so validateMnemonic accepts it
// client-side and the submit reaches recoverAccess().
const VALID_MNEMONIC =
  'hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length'

function renderRecoveryScreen(props: Partial<React.ComponentProps<typeof RecoveryScreen>> = {}) {
  return render(
    <I18nProvider i18n={i18n}>
      <RecoveryScreen baseUrl="http://api.test" {...props} />
    </I18nProvider>,
  )
}

function fillForm(email: string, mnemonic: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Frase de recuperação'), { target: { value: mnemonic } })
}

describe('RecoveryScreen', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('rejects a malformed mnemonic client-side with a generic message, naming no specific word, and never calls recoverAccess', async () => {
    renderRecoveryScreen()

    fillForm('user@example.com', 'not a real recovery phrase at all')
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acesso' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Frase de recuperação inválida. Verifique se você digitou todas as palavras corretamente.')

    for (const word of ['not', 'a', 'real', 'recovery', 'phrase', 'at', 'all']) {
      expect(document.body.textContent).not.toContain(`"${word}"`)
    }
    expect(recoverAccessMock).not.toHaveBeenCalled()
  })

  it('rejects a well-formed mnemonic the server does not recognize, with the same generic wording, naming no specific word', async () => {
    recoverAccessMock.mockResolvedValue({ ok: false, code: 'auth.invalid_recovery_phrase', params: {} })
    renderRecoveryScreen()

    fillForm('user@example.com', VALID_MNEMONIC)
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acesso' }))

    await waitFor(() => expect(recoverAccessMock).toHaveBeenCalledTimes(1))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('E-mail ou frase de recuperação inválidos.')

    for (const word of VALID_MNEMONIC.split(' ')) {
      expect(alert.textContent).not.toContain(word)
    }
  }, 15000)

  it('submits with the Argon2id-derived recovery verifier, never the plaintext mnemonic', async () => {
    recoverAccessMock.mockResolvedValue({
      ok: true,
      account: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        role: 'Professional',
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      },
    })
    renderRecoveryScreen()

    fillForm('user@example.com', VALID_MNEMONIC)
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acesso' }))

    await waitFor(() => expect(recoverAccessMock).toHaveBeenCalledTimes(1))

    const call = recoverAccessMock.mock.calls[0]
    expect(call?.[0]).toBe('http://api.test')
    const requestArg = call?.[1] as { email: string; recoveryVerifier: Uint8Array }
    expect(requestArg.email).toBe('user@example.com')

    const plaintextBytes = new TextEncoder().encode(VALID_MNEMONIC)
    expect(requestArg.recoveryVerifier).not.toEqual(plaintextBytes)
    expect(new TextDecoder().decode(requestArg.recoveryVerifier)).not.toContain('hamster diagram')

    const expectedSalt = await deriveEmailSalt('user@example.com')
    const expectedVerifier = await deriveRecoveryVerifier(VALID_MNEMONIC, expectedSalt)
    expect(requestArg.recoveryVerifier).toEqual(expectedVerifier)
  }, 15000)

  it('a recovered account with twoFactorRequirement: NotApplicable goes straight to success and calls onRecovered', async () => {
    const account = {
      id: '22222222-2222-2222-2222-222222222222',
      email: 'patient@example.com',
      role: 'Patient' as const,
      twoFactorRequirement: 'NotApplicable' as const,
      twoFactorTicket: null,
    }
    recoverAccessMock.mockResolvedValue({ ok: true, account })
    const onRecovered = vi.fn()
    renderRecoveryScreen({ onRecovered })

    fillForm('patient@example.com', VALID_MNEMONIC)
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acesso' }))

    expect((await screen.findByRole('status')).textContent).toBe('Acesso recuperado com sucesso.')
    expect(onRecovered).toHaveBeenCalledWith(account)
  }, 15000)

  it('a recovered account with twoFactorRequirement: ChallengeRequired routes into TotpChallenge, and onRecovered fires only once it is verified', async () => {
    const account = {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'pro@example.com',
      role: 'Professional' as const,
      twoFactorRequirement: 'ChallengeRequired' as const,
      twoFactorTicket: 'ticket-recovery-challenge',
    }
    recoverAccessMock.mockResolvedValue({ ok: true, account })
    const onRecovered = vi.fn()
    renderRecoveryScreen({ onRecovered })

    fillForm('pro@example.com', VALID_MNEMONIC)
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acesso' }))

    expect(await screen.findByRole('button', { name: 'Verificar' })).toBeTruthy()
    expect(onRecovered).not.toHaveBeenCalled()

    verifyTotpChallengeMock.mockResolvedValue({ ok: true, account: { ...account, twoFactorTicket: null } })
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }))

    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1))
    expect(verifyTotpChallengeMock).toHaveBeenCalledWith('http://api.test', account.id, 'ticket-recovery-challenge', {
      code: '123456',
    })
  }, 15000)

  it('a recovered account with twoFactorRequirement: SetupRequired routes into TotpSetup, and onRecovered fires only once enrollment is confirmed', async () => {
    const account = {
      id: '44444444-4444-4444-4444-444444444444',
      email: 'pro2@example.com',
      role: 'Professional' as const,
      twoFactorRequirement: 'SetupRequired' as const,
      twoFactorTicket: 'ticket-recovery-setup',
    }
    recoverAccessMock.mockResolvedValue({ ok: true, account })
    beginTotpEnrollmentMock.mockResolvedValue({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:pro2@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    const backupCodes = Array.from({ length: 10 }, (_, index) => `abcde-${index}0000`)
    confirmTotpEnrollmentMock.mockResolvedValue({ ok: true, backupCodes })
    const onRecovered = vi.fn()
    renderRecoveryScreen({ onRecovered })

    fillForm('pro2@example.com', VALID_MNEMONIC)
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar acesso' }))

    await waitFor(() =>
      expect(beginTotpEnrollmentMock).toHaveBeenCalledWith('http://api.test', account.id, 'ticket-recovery-setup'),
    )
    expect(await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')).toBeTruthy()
    expect(onRecovered).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/código de 6 dígitos/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Guardei meus códigos' }))

    expect(onRecovered).toHaveBeenCalledWith(account)
  }, 15000)
})
