import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { deriveEmailPasswordVerifier, deriveEmailSalt } from '../../entities/account/password-verifier'
import * as accountApi from '../../entities/account/api'
import { AuthScreen } from './AuthScreen'

vi.mock('../../entities/account/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api')
  return {
    ...actual,
    register: vi.fn(),
    continueWithGoogle: vi.fn(),
    beginTotpEnrollment: vi.fn(),
    confirmTotpEnrollment: vi.fn(),
    verifyTotpChallenge: vi.fn(),
    requestMagicLink: vi.fn(),
  }
})

const registerMock = vi.mocked(accountApi.register)
const continueWithGoogleMock = vi.mocked(accountApi.continueWithGoogle)
const beginTotpEnrollmentMock = vi.mocked(accountApi.beginTotpEnrollment)
const confirmTotpEnrollmentMock = vi.mocked(accountApi.confirmTotpEnrollment)
const verifyTotpChallengeMock = vi.mocked(accountApi.verifyTotpChallenge)
const requestMagicLinkMock = vi.mocked(accountApi.requestMagicLink)

function renderAuthScreen(props: Partial<React.ComponentProps<typeof AuthScreen>> = {}) {
  const getGoogleIdToken = props.getGoogleIdToken ?? vi.fn().mockResolvedValue('google-id-token')
  return render(
    <I18nProvider i18n={i18n}>
      <AuthScreen baseUrl="http://api.test" getGoogleIdToken={getGoogleIdToken} {...props} />
    </I18nProvider>,
  )
}

describe('AuthScreen', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('defaults to "profissional" and shows the professional support text', () => {
    renderAuthScreen()

    expect((screen.getByRole('radio', { name: 'Profissional' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Gerencie pacientes, prontuários e agenda em um só lugar.')).toBeTruthy()
  })

  it('switches the segmented control to "paciente" and updates the support text (visually and in copy)', () => {
    renderAuthScreen()

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))

    expect((screen.getByRole('radio', { name: 'Paciente' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Profissional' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('Acompanhe suas consultas e informações de saúde com segurança.')).toBeTruthy()

    fireEvent.click(screen.getByRole('radio', { name: 'Profissional' }))

    expect((screen.getByRole('radio', { name: 'Profissional' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Gerencie pacientes, prontuários e agenda em um só lugar.')).toBeTruthy()
  })

  it('submitting the e-mail form calls register() with the Argon2id-derived verifier, never the plaintext password', async () => {
    registerMock.mockResolvedValue({
      ok: true,
      account: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        role: 'Professional',
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      },
    })
    renderAuthScreen()

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1))

    const call = registerMock.mock.calls[0]
    expect(call?.[0]).toBe('http://api.test')
    const requestArg = call?.[1] as { email: string; passwordVerifier: Uint8Array; role: string }
    expect(requestArg.email).toBe('user@example.com')
    expect(requestArg.role).toBe('Professional')

    // Never the plaintext password: neither the raw string nor its UTF-8
    // bytes appear anywhere in what was actually sent.
    const plaintextBytes = new TextEncoder().encode('correct horse battery staple')
    expect(requestArg.passwordVerifier).not.toEqual(plaintextBytes)
    expect(new TextDecoder().decode(requestArg.passwordVerifier)).not.toContain('correct horse')

    // Exactly the documented pipeline: deriveEmailSalt(email) then
    // deriveEmailPasswordVerifier(password, salt) -- not some other value.
    const expectedSalt = await deriveEmailSalt('user@example.com')
    const expectedVerifier = await deriveEmailPasswordVerifier('correct horse battery staple', expectedSalt)
    expect(requestArg.passwordVerifier).toEqual(expectedVerifier)
  }, 15000)

  it('shows a translated error message when register() reports a problem', async () => {
    registerMock.mockResolvedValue({ ok: false, code: 'auth.email_already_registered', params: {} })
    renderAuthScreen()

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'taken@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Este e-mail já está cadastrado.')
  }, 15000)

  it('clicking the Google button calls continueWithGoogle() with the token and the selected role', async () => {
    const getGoogleIdToken = vi.fn().mockResolvedValue('google-id-token')
    continueWithGoogleMock.mockResolvedValue({
      ok: true,
      account: {
        id: '22222222-2222-2222-2222-222222222222',
        email: 'user@example.com',
        role: 'Patient',
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      },
      isNewAccount: true,
    })
    renderAuthScreen({ getGoogleIdToken })

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))

    await waitFor(() => expect(continueWithGoogleMock).toHaveBeenCalledTimes(1))
    expect(continueWithGoogleMock).toHaveBeenCalledWith('http://api.test', {
      idToken: 'google-id-token',
      requestedRole: 'Patient',
    })
  })

  it('shows a translated error message when continueWithGoogle() reports a problem', async () => {
    const getGoogleIdToken = vi.fn().mockResolvedValue('bad-token')
    continueWithGoogleMock.mockResolvedValue({ ok: false, code: 'auth.google_token_invalid', params: {} })
    renderAuthScreen({ getGoogleIdToken })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível continuar com o Google. Tente novamente.',
    )
  })

  it('does not re-prompt for a role when Google resolves an existing account to a different role than selected', async () => {
    const getGoogleIdToken = vi.fn().mockResolvedValue('google-id-token')
    // User has "Profissional" selected locally, but the Google identity's
    // e-mail already has an account as a Patient (ADR-S02-01: backend wins).
    continueWithGoogleMock.mockResolvedValue({
      ok: true,
      account: {
        id: '33333333-3333-3333-3333-333333333333',
        email: 'existing@example.com',
        role: 'Patient',
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      },
      isNewAccount: false,
    })
    renderAuthScreen({ getGoogleIdToken })

    expect((screen.getByRole('radio', { name: 'Profissional' }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))

    expect((await screen.findByRole('status')).textContent).toBe(
      'Conta criada. Você está cadastrado como paciente.',
    )
    // No second role prompt: the segmented control still shows the
    // (now-irrelevant) local selection, and no additional radiogroup appears.
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
  })

  // S02-03/S02-04 wiring: register()/continueWithGoogle() success is no
  // longer immediately "authenticated" for a Professional account with
  // pending or confirmed 2FA -- see AuthScreen's handleAccountResult.
  it('routes a freshly-registered professional (twoFactorRequirement: SetupRequired) into TotpSetup instead of success', async () => {
    registerMock.mockResolvedValue({
      ok: true,
      account: {
        id: '44444444-4444-4444-4444-444444444444',
        email: 'pro@example.com',
        role: 'Professional',
        twoFactorRequirement: 'SetupRequired',
        twoFactorTicket: 'ticket-pro-setup',
      },
    })
    // TotpSetup calls beginTotpEnrollment on mount; resolve it so step 1 renders.
    beginTotpEnrollmentMock.mockResolvedValue({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:pro@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    const onAuthenticated = vi.fn()
    renderAuthScreen({ onAuthenticated })

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pro@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await waitFor(() =>
      expect(beginTotpEnrollmentMock).toHaveBeenCalledWith(
        'http://api.test',
        '44444444-4444-4444-4444-444444444444',
        'ticket-pro-setup',
      ),
    )
    expect(await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')).toBeTruthy()

    // Not authenticated yet: the registration form's own "success" copy and
    // onAuthenticated must not have fired.
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(screen.queryByText('Conta criada. Você está cadastrado como profissional.')).toBeNull()
  }, 15000)

  it('a Google sign-in for a patient (twoFactorRequirement: NotApplicable) still goes straight to success, unchanged', async () => {
    const getGoogleIdToken = vi.fn().mockResolvedValue('google-id-token')
    continueWithGoogleMock.mockResolvedValue({
      ok: true,
      account: {
        id: '55555555-5555-5555-5555-555555555555',
        email: 'patient@example.com',
        role: 'Patient',
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      },
      isNewAccount: true,
    })
    const onAuthenticated = vi.fn()
    renderAuthScreen({ getGoogleIdToken, onAuthenticated })

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))

    expect((await screen.findByRole('status')).textContent).toBe(
      'Conta criada. Você está cadastrado como paciente.',
    )
    expect(onAuthenticated).toHaveBeenCalledWith({
      id: '55555555-5555-5555-5555-555555555555',
      email: 'patient@example.com',
      role: 'Patient',
      twoFactorRequirement: 'NotApplicable',
      twoFactorTicket: null,
    })
  }, 15000)

  it('routes a Google sign-in with twoFactorRequirement: ChallengeRequired into TotpChallenge', async () => {
    const getGoogleIdToken = vi.fn().mockResolvedValue('google-id-token')
    continueWithGoogleMock.mockResolvedValue({
      ok: true,
      account: {
        id: '66666666-6666-6666-6666-666666666666',
        email: 'pro@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: 'ticket-pro-challenge',
      },
      isNewAccount: false,
    })
    const onAuthenticated = vi.fn()
    renderAuthScreen({ getGoogleIdToken, onAuthenticated })

    fireEvent.click(screen.getByRole('button', { name: 'Continuar com o Google' }))

    expect(await screen.findByRole('button', { name: 'Verificar' })).toBeTruthy()
    expect(onAuthenticated).not.toHaveBeenCalled()

    verifyTotpChallengeMock.mockResolvedValue({
      ok: true,
      account: {
        id: '66666666-6666-6666-6666-666666666666',
        email: 'pro@example.com',
        role: 'Professional',
        twoFactorRequirement: 'ChallengeRequired',
        twoFactorTicket: null,
      },
    })
    fireEvent.change(screen.getByLabelText(/código/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    expect(verifyTotpChallengeMock).toHaveBeenCalledWith(
      'http://api.test',
      '66666666-6666-6666-6666-666666666666',
      'ticket-pro-challenge',
      { code: '123456' },
    )
  })

  it('calling TotpSetup.onDone (after confirming enrollment) completes authentication', async () => {
    registerMock.mockResolvedValue({
      ok: true,
      account: {
        id: '77777777-7777-7777-7777-777777777777',
        email: 'pro2@example.com',
        role: 'Professional',
        twoFactorRequirement: 'SetupRequired',
        twoFactorTicket: 'ticket-pro2-setup',
      },
    })
    beginTotpEnrollmentMock.mockResolvedValue({
      ok: true,
      secret: 'JBSWY3DPEHPK3PXP',
      provisioningUri: 'otpauth://totp/Limmiar:pro2@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Limmiar',
    })
    const backupCodes = Array.from({ length: 10 }, (_, index) => `abcde-${index}0000`)
    confirmTotpEnrollmentMock.mockResolvedValue({ ok: true, backupCodes })
    const onAuthenticated = vi.fn()
    renderAuthScreen({ onAuthenticated })

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pro2@example.com' } })
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await screen.findByDisplayValue('JBSWY3DPEHPK3PXP')
    fireEvent.change(screen.getByLabelText(/código de 6 dígitos/i), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(confirmTotpEnrollmentMock).toHaveBeenCalledWith(
      'http://api.test',
      '77777777-7777-7777-7777-777777777777',
      'ticket-pro2-setup',
      '123456',
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Guardei meus códigos' }))

    expect(onAuthenticated).toHaveBeenCalledWith({
      id: '77777777-7777-7777-7777-777777777777',
      email: 'pro2@example.com',
      role: 'Professional',
      twoFactorRequirement: 'SetupRequired',
      twoFactorTicket: 'ticket-pro2-setup',
    })
    expect((await screen.findByRole('status')).textContent).toBe(
      'Conta criada. Você está cadastrado como profissional.',
    )
  }, 15000)

  it('shows no password field for the "paciente" segment', () => {
    renderAuthScreen()

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))

    expect(screen.queryByLabelText('Senha')).toBeNull()
  })

  it('still shows the password field for the "profissional" segment (unchanged)', () => {
    renderAuthScreen()

    expect(screen.getByLabelText('Senha')).toBeTruthy()
  })

  it('shows "Enviar link mágico" (not "Criar conta") as the submit label for the "paciente" segment', () => {
    renderAuthScreen()

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))

    expect(screen.getByRole('button', { name: 'Enviar link mágico' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Criar conta' })).toBeNull()
  })

  it('still shows "Criar conta" (not "Enviar link mágico") as the submit label for the "profissional" segment (unchanged)', () => {
    renderAuthScreen()

    expect(screen.getByRole('button', { name: 'Criar conta' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enviar link mágico' })).toBeNull()
  })

  it('submitting the "paciente" form calls requestMagicLink(), not register(), and replaces the form with the "check your email" state', async () => {
    requestMagicLinkMock.mockResolvedValue({ ok: true })
    renderAuthScreen()

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'patient@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link mágico' }))

    await waitFor(() => expect(requestMagicLinkMock).toHaveBeenCalledTimes(1))
    expect(requestMagicLinkMock).toHaveBeenCalledWith('http://api.test', { email: 'patient@example.com' })
    expect(registerMock).not.toHaveBeenCalled()

    expect((await screen.findByRole('status')).textContent).toBe(
      'Verifique seu e-mail para continuar. Enviamos um link de acesso, se este e-mail existir.',
    )

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByLabelText('E-mail')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enviar link mágico' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continuar com o Google' })).toBeNull()
  })

  it('shows a translated error message when requestMagicLink() reports a problem', async () => {
    requestMagicLinkMock.mockResolvedValue({ ok: false, code: 'validation.invalid_field', params: { field: 'email' } })
    renderAuthScreen()

    fireEvent.click(screen.getByRole('radio', { name: 'Paciente' }))
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'patient@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link mágico' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Campo inválido: email.')
  })
})
