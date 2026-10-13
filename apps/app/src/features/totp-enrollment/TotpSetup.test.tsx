import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import QRCode from 'qrcode'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as accountApi from '../../entities/account/api'
import { TotpSetup } from './TotpSetup'

vi.mock('../../entities/account/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api')
  return {
    ...actual,
    beginTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
  }
})

const beginTotpEnrollmentMock = vi.mocked(accountApi.beginTotpEnrollment)
const confirmTotpEnrollmentMock = vi.mocked(accountApi.confirmTotpEnrollment)

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
  it('informa falha de rede no início e na confirmação', async () => {
    beginTotpEnrollmentMock.mockRejectedValueOnce(new Error('rede'))
    const view = renderTotpSetup()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível conectar. Tente novamente.')
    view.unmount()
    beginTotpEnrollmentMock.mockResolvedValueOnce({ ok: true, secret: 'SEGREDO', provisioningUri: 'otpauth://totp/local' })
    confirmTotpEnrollmentMock.mockRejectedValueOnce(new Error('rede'))
    renderTotpSetup()
    await screen.findByDisplayValue('SEGREDO')
    fireEvent.change(screen.getByLabelText(/código de 6 dígitos/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível conectar. Tente novamente.')
  })
  it('ignora falha de início recebida após desmontar', async () => {
    let rejeitar!: (erro: Error) => void
    beginTotpEnrollmentMock.mockReturnValueOnce(new Promise((_resolve, reject) => { rejeitar = reject }))
    const view = renderTotpSetup()
    view.unmount()
    rejeitar(new Error('resposta tardia'))
    await Promise.resolve()
    expect(screen.queryByRole('alert')).toBeNull()
  })
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

  it('mostra o QR do link de provisionamento e, se o QR falhar, mantém o código secreto', async () => {
    const resposta = { ok: true as const, secret: 'JBSWY3DPEHPK3PXP', provisioningUri: 'otpauth://totp/Limmiar:user@example.com?secret=JBSWY3DPEHPK3PXP' }
    beginTotpEnrollmentMock.mockResolvedValue(resposta)
    const comQr = renderTotpSetup()
    expect((await screen.findByAltText(/Código QR/)).getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    comQr.unmount()

    vi.spyOn(QRCode, 'toDataURL').mockRejectedValueOnce(new Error('falha'))
    renderTotpSetup()
    expect(await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')).toBeTruthy()
    expect(screen.queryByAltText(/Código QR/)).toBeNull()
  })

  it('ignora o QR que termina depois de desmontar', async () => {
    let terminaQr: (url: string) => void = () => {}
    beginTotpEnrollmentMock.mockResolvedValue({ ok: true, secret: 'SEGREDO', provisioningUri: 'otpauth://totp/x' })
    vi.spyOn(QRCode, 'toDataURL').mockImplementationOnce(
      () => new Promise<string>((resolve) => { terminaQr = resolve }) as unknown as ReturnType<typeof QRCode.toDataURL>,
    )
    const { unmount } = renderTotpSetup()
    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalled())
    unmount()
    expect(() => terminaQr('data:image/png;base64,x')).not.toThrow()
  })

  it('uma resposta de início atrasada de outro ticket nunca sobrescreve a tela atual', async () => {
    const velho = deferred<accountApi.BeginTotpEnrollmentResult>()
    const novo = deferred<accountApi.BeginTotpEnrollmentResult>()
    beginTotpEnrollmentMock.mockReturnValueOnce(velho.promise).mockReturnValueOnce(novo.promise)
    const qr = vi.spyOn(QRCode, 'toDataURL')
    const view = renderTotpSetup()
    view.rerender(<I18nProvider i18n={i18n}><TotpSetup baseUrl="http://api.test" accountId={ACCOUNT_ID} ticket="outro-ticket" onDone={vi.fn()} /></I18nProvider>)
    expect(beginTotpEnrollmentMock).toHaveBeenLastCalledWith('http://api.test', ACCOUNT_ID, 'outro-ticket')
    novo.resolve({ ok: true, secret: 'NOVO', provisioningUri: 'otpauth://totp/novo' })
    await screen.findByDisplayValue('NOVO')
    qr.mockClear()

    velho.resolve({ ok: true, secret: 'VELHO', provisioningUri: 'otpauth://totp/velho' })
    await act(async () => { await Promise.resolve() })

    expect(qr).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('VELHO')).toBeNull()
    expect(screen.getByDisplayValue('NOVO')).toBeTruthy()
  })

  it('um QR atrasado de outro ticket nunca sobrescreve a tela atual', async () => {
    const qrVelho = deferred<string>()
    beginTotpEnrollmentMock
      .mockResolvedValueOnce({ ok: true, secret: 'VELHO', provisioningUri: 'otpauth://totp/velho' })
      .mockResolvedValueOnce({ ok: true, secret: 'NOVO', provisioningUri: 'otpauth://totp/novo' })
    vi.spyOn(QRCode, 'toDataURL').mockImplementationOnce(() => qrVelho.promise as unknown as ReturnType<typeof QRCode.toDataURL>)
    const view = renderTotpSetup()
    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledWith('otpauth://totp/velho'))
    view.rerender(<I18nProvider i18n={i18n}><TotpSetup baseUrl="http://api.test" accountId={ACCOUNT_ID} ticket="outro-ticket" onDone={vi.fn()} /></I18nProvider>)
    await screen.findByDisplayValue('NOVO')

    qrVelho.resolve('data:image/png;base64,velho')
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByDisplayValue('VELHO')).toBeNull()
    expect(screen.getByDisplayValue('NOVO')).toBeTruthy()
    expect(screen.getByAltText(/Código QR/).getAttribute('src')).not.toBe('data:image/png;base64,velho')
  })

  it('uma falha de início atrasada de outro ticket não mostra erro sobre a tela atual', async () => {
    const velho = deferred<accountApi.BeginTotpEnrollmentResult>()
    beginTotpEnrollmentMock
      .mockReturnValueOnce(velho.promise)
      .mockResolvedValueOnce({ ok: true, secret: 'NOVO', provisioningUri: 'otpauth://totp/novo' })
    const view = renderTotpSetup()
    view.rerender(<I18nProvider i18n={i18n}><TotpSetup baseUrl="http://api.test" accountId={ACCOUNT_ID} ticket="outro-ticket" onDone={vi.fn()} /></I18nProvider>)
    await screen.findByDisplayValue('NOVO')

    velho.reject(new Error('rede'))
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByDisplayValue('NOVO')).toBeTruthy()
  })

  it.each([
    ['baseUrl', { baseUrl: 'http://outra.test' }, ['http://outra.test', ACCOUNT_ID, TICKET]],
    ['accountId', { accountId: 'outra-conta' }, ['http://api.test', 'outra-conta', TICKET]],
    ['ticket', { ticket: 'outro-ticket' }, ['http://api.test', ACCOUNT_ID, 'outro-ticket']],
  ])('recomeça o pareamento quando %s muda e não repete quando nada muda', async (_nome, troca, esperado) => {
    beginTotpEnrollmentMock.mockResolvedValue({ ok: true, secret: 'SEGREDO', provisioningUri: 'otpauth://totp/x' })
    const props = { baseUrl: 'http://api.test', accountId: ACCOUNT_ID, ticket: TICKET, onDone: vi.fn() }
    const view = render(<I18nProvider i18n={i18n}><TotpSetup {...props} /></I18nProvider>)
    await screen.findByDisplayValue('SEGREDO')
    view.rerender(<I18nProvider i18n={i18n}><TotpSetup {...props} /></I18nProvider>)
    expect(beginTotpEnrollmentMock).toHaveBeenCalledTimes(1)

    view.rerender(<I18nProvider i18n={i18n}><TotpSetup {...props} {...troca} /></I18nProvider>)

    await waitFor(() => expect(beginTotpEnrollmentMock).toHaveBeenCalledTimes(2))
    expect(beginTotpEnrollmentMock).toHaveBeenLastCalledWith(...esperado)
  })

  it('enquanto o servidor prepara a verificação mostra só o aviso de preparo', async () => {
    const preparo = deferred<accountApi.BeginTotpEnrollmentResult>()
    beginTotpEnrollmentMock.mockReturnValueOnce(preparo.promise)
    renderTotpSetup()
    expect(screen.getByRole('status').textContent).toBe('Preparando a verificação em duas etapas...')
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull()
    await act(async () => preparo.resolve({ ok: true, secret: 'SEGREDO', provisioningUri: 'otpauth://totp/x' }))
    await screen.findByDisplayValue('SEGREDO')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByLabelText(/código de 6 dígitos/i)).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveProperty('disabled', false)
  })

  it('bloqueia o botão enquanto confirma e entrega à tela seguinte os tokens recebidos', async () => {
    beginTotpEnrollmentMock.mockResolvedValue({ ok: true, secret: 'SEGREDO', provisioningUri: 'otpauth://totp/x' })
    const confirmacao = deferred<accountApi.ConfirmTotpEnrollmentResult>()
    confirmTotpEnrollmentMock.mockReturnValueOnce(confirmacao.promise)
    const onDone = vi.fn()
    renderTotpSetup(onDone)
    await screen.findByDisplayValue('SEGREDO')
    fireEvent.change(screen.getByLabelText(/código de 6 dígitos/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveProperty('disabled', true))

    await act(async () => confirmacao.resolve({ ok: true, backupCodes: ['abcde-00000'], accessToken: 'acesso', refreshToken: 'renovacao', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Guardei meus códigos' }))

    expect(onDone).toHaveBeenCalledWith({ accessToken: 'acesso', refreshToken: 'renovacao', accessTokenExpiresAt: '2099-01-01T00:00:00Z' })
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
    confirmTotpEnrollmentMock.mockResolvedValue({accessToken: 'test-access', refreshToken: 'test-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z',  ok: true, backupCodes })
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

describe('TotpSetup: troca de idioma', () => {
  afterEach(async () => {
    cleanup()
    vi.clearAllMocks()
    await dynamicActivate('pt-BR')
  })

  it('não pede outro segredo ao servidor e mantém o que o usuário já vê', async () => {
    beginTotpEnrollmentMock.mockResolvedValue({ ok: true, secret: 'JBSWY3DPEHPK3PXP', provisioningUri: 'otpauth://totp/local' })
    renderTotpSetup()
    await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')

    await act(() => dynamicActivate('en-US'))

    expect(await screen.findByRole('heading', { name: 'Set up two-factor verification' })).toBeTruthy()
    expect(screen.getByDisplayValue('JBSWY3DPEHPK3PXP')).toBeTruthy()
    expect(beginTotpEnrollmentMock).toHaveBeenCalledOnce()
  })

  it('retraduz a falha de rede já mostrada', async () => {
    beginTotpEnrollmentMock.mockRejectedValue(new Error('rede'))
    renderTotpSetup()
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível conectar. Tente novamente.')

    await act(() => dynamicActivate('en-US'))

    expect(screen.getByRole('alert').textContent).toBe('Could not connect. Try again.')
    expect(beginTotpEnrollmentMock).toHaveBeenCalledOnce()
  })
})
