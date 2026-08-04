import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../i18n'
import { deriveEmailPasswordVerifier, deriveEmailSalt } from './password-verifier'
import * as client from '../api/client'
import { AuthScreen } from './AuthScreen'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    register: vi.fn(),
    continueWithGoogle: vi.fn(),
  }
})

const registerMock = vi.mocked(client.register)
const continueWithGoogleMock = vi.mocked(client.continueWithGoogle)

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
      account: { id: '11111111-1111-1111-1111-111111111111', email: 'user@example.com', role: 'Professional' },
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
      account: { id: '22222222-2222-2222-2222-222222222222', email: 'user@example.com', role: 'Patient' },
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
      account: { id: '33333333-3333-3333-3333-333333333333', email: 'existing@example.com', role: 'Patient' },
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
})
