import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as accountApi from '../../entities/account/api'
import type { Account } from '../../entities/account'
import { TotpChallenge } from './TotpChallenge'

vi.mock('../../entities/account/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api')
  return {
    ...actual,
    verifyTotpChallenge: vi.fn(),
  }
})

const verifyTotpChallengeMock = vi.mocked(accountApi.verifyTotpChallenge)

const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const TICKET = 'two-factor-ticket-xyz'

function renderTotpChallenge(onVerified: (account: Account) => void = vi.fn()) {
  return render(
    <I18nProvider i18n={i18n}>
      <TotpChallenge baseUrl="http://api.test" accountId={ACCOUNT_ID} ticket={TICKET} onVerified={onVerified} />
    </I18nProvider>,
  )
}

describe('TotpChallenge', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders an empty, enabled form with no alert on mount', () => {
    renderTotpChallenge()

    expect((screen.getByLabelText(/código/i) as HTMLInputElement).value).toBe('')
    expect(screen.getByPlaceholderText('Código ou código de backup')).toBeTruthy()
    expect((screen.getByRole('button', { name: /verificar/i }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables the submit button while the verification request is in flight', async () => {
    let resolveVerify!: (value: Awaited<ReturnType<typeof accountApi.verifyTotpChallenge>>) => void
    verifyTotpChallengeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveVerify = resolve
      }),
    )
    renderTotpChallenge()

    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }))

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /verificar/i }) as HTMLButtonElement).disabled).toBe(true),
    )

    resolveVerify({ ok: false, code: 'auth.totp_invalid_code', params: {} })
    await screen.findByRole('alert')
    expect((screen.getByRole('button', { name: /verificar/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits a 6-digit code as { code } (with the ticket) and calls onVerified with the authenticated account', async () => {
    const account: Account = {
      id: ACCOUNT_ID,
      email: 'user@example.com',
      role: 'Professional',
      twoFactorRequirement: 'ChallengeRequired',
      twoFactorTicket: null,
    }
    verifyTotpChallengeMock.mockResolvedValue({ ok: true, account })
    const onVerified = vi.fn()
    renderTotpChallenge(onVerified)

    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }))

    await waitFor(() =>
      expect(verifyTotpChallengeMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, TICKET, { code: '123456' }),
    )
    expect(onVerified).toHaveBeenCalledWith(account)
  })

  it('submits a value with a trailing 6-digit run but a non-digit prefix as { backupCode }, not { code }', async () => {
    const account: Account = {
      id: ACCOUNT_ID,
      email: 'user@example.com',
      role: 'Professional',
      twoFactorRequirement: 'ChallengeRequired',
      twoFactorTicket: null,
    }
    verifyTotpChallengeMock.mockResolvedValue({ ok: true, account })
    renderTotpChallenge()

    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: 'abc123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }))

    await waitFor(() =>
      expect(verifyTotpChallengeMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, TICKET, {
        backupCode: 'abc123456',
      }),
    )
  })

  it('submits a hyphenated backup code as { backupCode } (with the ticket) and calls onVerified', async () => {
    const account: Account = {
      id: ACCOUNT_ID,
      email: 'user@example.com',
      role: 'Professional',
      twoFactorRequirement: 'ChallengeRequired',
      twoFactorTicket: null,
    }
    verifyTotpChallengeMock.mockResolvedValue({ ok: true, account })
    const onVerified = vi.fn()
    renderTotpChallenge(onVerified)

    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: 'abcde-12345' } })
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }))

    await waitFor(() =>
      expect(verifyTotpChallengeMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, TICKET, {
        backupCode: 'abcde-12345',
      }),
    )
    expect(onVerified).toHaveBeenCalledWith(account)
  })

  it('shows a translated error and does not call onVerified when the code is rejected', async () => {
    verifyTotpChallengeMock.mockResolvedValue({ ok: false, code: 'auth.totp_invalid_code', params: {} })
    const onVerified = vi.fn()
    renderTotpChallenge(onVerified)

    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Código inválido. Verifique o app autenticador ou use um código de backup.',
    )
    expect(onVerified).not.toHaveBeenCalled()
  })
})
