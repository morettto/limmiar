import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import { TotpChallenge } from './TotpChallenge'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    verifyTotpChallenge: vi.fn(),
  }
})

const verifyTotpChallengeMock = vi.mocked(client.verifyTotpChallenge)

const ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const TICKET = 'two-factor-ticket-xyz'

function renderTotpChallenge(onVerified: (account: client.AccountResult) => void = vi.fn()) {
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

  it('submits a 6-digit code as { code } (with the ticket) and calls onVerified with the authenticated account', async () => {
    const account: client.AccountResult = {
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

  it('submits a hyphenated backup code as { backupCode } (with the ticket) and calls onVerified', async () => {
    const account: client.AccountResult = {
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
