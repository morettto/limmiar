import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../i18n'
import * as client from '../api/client'
import { TotpSetup } from './TotpSetup'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    beginTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
  }
})

const beginTotpEnrollmentMock = vi.mocked(client.beginTotpEnrollment)
const confirmTotpEnrollmentMock = vi.mocked(client.confirmTotpEnrollment)

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const TICKET = 'two-factor-ticket-abc'

function renderTotpSetup(onDone: () => void = vi.fn()) {
  return render(
    <I18nProvider i18n={i18n}>
      <TotpSetup baseUrl="http://api.test" accountId={ACCOUNT_ID} ticket={TICKET} onDone={onDone} />
    </I18nProvider>,
  )
}

describe('TotpSetup', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('begins enrollment on mount and shows the secret + provisioning URI once it resolves', async () => {
    beginTotpEnrollmentMock.mockResolvedValue({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    renderTotpSetup()

    await waitFor(() => expect(beginTotpEnrollmentMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, TICKET))

    const secretInput = await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')
    const uriInput = screen.getByDisplayValue(
      'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    )
    expect(secretInput).toBeTruthy()
    expect(uriInput).toBeTruthy()

    // Both read-only fields select their full contents on focus, so a tap/click
    // on either lets the user copy the value in one gesture.
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select')
    fireEvent.focus(secretInput)
    fireEvent.focus(uriInput)
    expect(selectSpy).toHaveBeenCalledTimes(2)
    selectSpy.mockRestore()
  })

  it('does not update state after unmounting while beginTotpEnrollment is still pending', async () => {
    let resolveBegin: (result: { ok: true; secret: string; provisioningUri: string }) => void = () => {}
    beginTotpEnrollmentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBegin = resolve
        }),
    )
    const { unmount } = renderTotpSetup()

    await waitFor(() => expect(beginTotpEnrollmentMock).toHaveBeenCalled())
    unmount()

    // Resolving after unmount must not throw (React "set state on an unmounted
    // component" warning would surface as an unhandled console.error/throw).
    expect(() =>
      resolveBegin({ ok: true, secret: 'JBSWY3DPEHPK3PXP', provisioningUri: 'otpauth://totp/whatever' }),
    ).not.toThrow()
  })

  it('shows a translated error when beginning enrollment fails', async () => {
    beginTotpEnrollmentMock.mockResolvedValue({ ok: false, code: 'auth.totp_already_enabled', params: {} })
    renderTotpSetup()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A verificação em duas etapas já está ativada para esta conta.',
    )
  })

  it('confirming a valid code advances to the dedicated backup-codes screen', async () => {
    beginTotpEnrollmentMock.mockResolvedValue({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    const backupCodes = Array.from({ length: 10 }, (_, index) => `abcde-${index}0000`)
    confirmTotpEnrollmentMock.mockResolvedValue({ ok: true, backupCodes })
    const onDone = vi.fn()
    renderTotpSetup(onDone)

    await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')

    fireEvent.change(screen.getByLabelText(/código de 6 dígitos/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(confirmTotpEnrollmentMock).toHaveBeenCalledWith('http://api.test', ACCOUNT_ID, TICKET, '123456'),
    )

    for (const backupCode of backupCodes) {
      expect(await screen.findByText(backupCode)).toBeTruthy()
    }
    // Dedicated screen: the enrollment secret/URI from step 1 must no longer be present.
    expect(screen.queryByDisplayValue('JBSWY3DPEHPK3PXP')).toBeNull()
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Guardei meus códigos' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows a translated error when confirming an invalid code, without losing the enrollment info', async () => {
    beginTotpEnrollmentMock.mockResolvedValue({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    confirmTotpEnrollmentMock.mockResolvedValue({ ok: false, code: 'auth.totp_invalid_code', params: {} })
    renderTotpSetup()

    await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')

    fireEvent.change(screen.getByLabelText(/código de 6 dígitos/i), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Código inválido. Verifique o app autenticador ou use um código de backup.',
    )
    // Still on the enrollment step -- the secret/URI stay visible for retry.
    expect(screen.getByDisplayValue('JBSWY3DPEHPK3PXP')).toBeTruthy()
  })
})
