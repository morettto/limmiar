import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as accountApi from '../../entities/account/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { MagicLinkCallback } from './MagicLinkCallback'

vi.mock('../../entities/account/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/account/api')>('../../entities/account/api')
  return {
    ...actual,
    verifyMagicLink: vi.fn(),
    completeWebAuthnCeremony: vi.fn(),
  }
})

const verifyMagicLinkMock = vi.mocked(accountApi.verifyMagicLink)
const completeWebAuthnCeremonyMock = vi.mocked(accountApi.completeWebAuthnCeremony)

const BASE_URL = 'http://api.test'
const TOKEN = 'raw-magic-link-token'
const MAGIC_LINK_TICKET = 'magic-link-ticket-abc'
const CHALLENGE = new Uint8Array([1, 2, 3, 4])
const RELYING_PARTY_ID = 'limmiar.test'
const CREDENTIAL_ID = new Uint8Array([9, 8, 7])
const CLIENT_DATA_JSON = new Uint8Array([10, 11])
const ATTESTATION_OBJECT = new Uint8Array([20, 21])
const AUTHENTICATOR_DATA = new Uint8Array([30, 31])
const SIGNATURE = new Uint8Array([40, 41])

const COMPLETED_ACCOUNT = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'patient@example.com',
  role: 'Patient' as const,
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  accessTokenExpiresAt: '2026-08-09T13:00:00Z',
}

function renderCallback(props: Partial<React.ComponentProps<typeof MagicLinkCallback>> = {}) {
  const createCredential = props.createCredential ?? vi.fn()
  const getCredential = props.getCredential ?? vi.fn()
  return render(
    <I18nProvider i18n={i18n}>
      <MagicLinkCallback
        baseUrl={BASE_URL}
        token={TOKEN}
        createCredential={createCredential}
        getCredential={getCredential}
        {...props}
      />
    </I18nProvider>,
  )
}

describe('MagicLinkCallback', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('a Register ceremony success calls createCredential, completes it, and calls onAuthenticated with the account', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    const createCredential = vi.fn().mockResolvedValue({
      credentialId: CREDENTIAL_ID,
      clientDataJson: CLIENT_DATA_JSON,
      attestationObject: ATTESTATION_OBJECT,
    })
    const getCredential = vi.fn()
    completeWebAuthnCeremonyMock.mockResolvedValue({ ok: true, account: COMPLETED_ACCOUNT })
    const onAuthenticated = vi.fn()

    renderCallback({ createCredential, getCredential, onAuthenticated })

    expect(screen.getByRole('status').textContent).toBe('Confirmando seu acesso...')

    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status').textContent).toBe('Login realizado com sucesso.')

    expect(verifyMagicLinkMock).toHaveBeenCalledWith(BASE_URL, { token: TOKEN })

    expect(createCredential).toHaveBeenCalledTimes(1)
    const createInput = createCredential.mock.calls[0]![0]
    expect(createInput.challenge).toEqual(CHALLENGE)
    expect(createInput.relyingPartyId).toBe(RELYING_PARTY_ID)
    expect(new TextDecoder().decode(createInput.userId)).toBe(MAGIC_LINK_TICKET)
    expect(createInput.userName).toBe(MAGIC_LINK_TICKET)
    expect(getCredential).not.toHaveBeenCalled()

    expect(completeWebAuthnCeremonyMock).toHaveBeenCalledWith(BASE_URL, {
      magicLinkTicket: MAGIC_LINK_TICKET,
      credentialId: encodeBase64(CREDENTIAL_ID),
      clientDataJson: encodeBase64(CLIENT_DATA_JSON),
      attestationObject: encodeBase64(ATTESTATION_OBJECT),
    })

    expect(onAuthenticated).toHaveBeenCalledWith({
      id: COMPLETED_ACCOUNT.id,
      email: COMPLETED_ACCOUNT.email,
      role: COMPLETED_ACCOUNT.role,
      twoFactorRequirement: 'NotApplicable',
      twoFactorTicket: null,
    })
    // The component no longer writes to storage itself -- that is the caller's job now
    // (SessionProvider.iniciarSessao, wired in app/routing/router.tsx). Proof is onAuthenticated
    // being called with the right account, asserted above.
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
  })

  it('an Assert ceremony success calls getCredential with allowCredentials and calls onAuthenticated', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Assert',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: encodeBase64(CREDENTIAL_ID),
    })
    const createCredential = vi.fn()
    const getCredential = vi.fn().mockResolvedValue({
      credentialId: CREDENTIAL_ID,
      clientDataJson: CLIENT_DATA_JSON,
      authenticatorData: AUTHENTICATOR_DATA,
      signature: SIGNATURE,
    })
    completeWebAuthnCeremonyMock.mockResolvedValue({ ok: true, account: COMPLETED_ACCOUNT })
    const onAuthenticated = vi.fn()

    renderCallback({ createCredential, getCredential, onAuthenticated })

    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))

    expect(createCredential).not.toHaveBeenCalled()
    expect(getCredential).toHaveBeenCalledTimes(1)
    const getInput = getCredential.mock.calls[0]![0]
    expect(getInput.challenge).toEqual(CHALLENGE)
    expect(getInput.relyingPartyId).toBe(RELYING_PARTY_ID)
    expect(getInput.credentialId).toEqual(decodeBase64(encodeBase64(CREDENTIAL_ID)))

    expect(completeWebAuthnCeremonyMock).toHaveBeenCalledWith(BASE_URL, {
      magicLinkTicket: MAGIC_LINK_TICKET,
      credentialId: encodeBase64(CREDENTIAL_ID),
      clientDataJson: encodeBase64(CLIENT_DATA_JSON),
      authenticatorData: encodeBase64(AUTHENTICATOR_DATA),
      signature: encodeBase64(SIGNATURE),
    })
  })

  it('shows a translated error and never runs the ceremony when verify fails', async () => {
    verifyMagicLinkMock.mockResolvedValue({ ok: false, code: 'auth.magic_link_invalid', params: {} })
    const createCredential = vi.fn()
    const getCredential = vi.fn()

    renderCallback({ createCredential, getCredential })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Este link de acesso não é mais válido. Solicite um novo.',
    )
    expect(createCredential).not.toHaveBeenCalled()
    expect(getCredential).not.toHaveBeenCalled()
    expect(completeWebAuthnCeremonyMock).not.toHaveBeenCalled()
  })

  it('shows a translated error when the browser WebAuthn ceremony is declined/rejected', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    const createCredential = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    const getCredential = vi.fn()

    renderCallback({ createCredential, getCredential })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível confirmar sua identidade neste dispositivo. Tente novamente.',
    )
    expect(completeWebAuthnCeremonyMock).not.toHaveBeenCalled()
  })

  it('shows a translated error when completeWebAuthnCeremony rejects the ceremony', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    const createCredential = vi.fn().mockResolvedValue({
      credentialId: CREDENTIAL_ID,
      clientDataJson: CLIENT_DATA_JSON,
      attestationObject: ATTESTATION_OBJECT,
    })
    const getCredential = vi.fn()
    completeWebAuthnCeremonyMock.mockResolvedValue({
      ok: false,
      code: 'auth.webauthn_ceremony_failed',
      params: {},
    })
    const onAuthenticated = vi.fn()

    renderCallback({ createCredential, getCredential, onAuthenticated })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível confirmar sua identidade neste dispositivo. Tente novamente.',
    )
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('shows an error, without calling getCredential, when an Assert ceremony carries no credentialId', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Assert',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    const createCredential = vi.fn()
    const getCredential = vi.fn()

    renderCallback({ createCredential, getCredential })

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível confirmar sua identidade neste dispositivo. Tente novamente.',
    )
    expect(getCredential).not.toHaveBeenCalled()
    expect(completeWebAuthnCeremonyMock).not.toHaveBeenCalled()
  })

  it('ignores a late verifyMagicLink resolution after the component unmounted', async () => {
    let resolveVerify!: (value: Awaited<ReturnType<typeof accountApi.verifyMagicLink>>) => void
    verifyMagicLinkMock.mockReturnValue(
      new Promise((resolve) => {
        resolveVerify = resolve
      }),
    )
    const createCredential = vi.fn()

    const { unmount } = renderCallback({ createCredential })
    unmount()

    resolveVerify({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })

    await vi.waitFor(() => expect(verifyMagicLinkMock).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(createCredential).not.toHaveBeenCalled()
    expect(completeWebAuthnCeremonyMock).not.toHaveBeenCalled()
  })

  it('ignores a late completeWebAuthnCeremony resolution after the component unmounted', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    const createCredential = vi.fn().mockResolvedValue({
      credentialId: CREDENTIAL_ID,
      clientDataJson: CLIENT_DATA_JSON,
      attestationObject: ATTESTATION_OBJECT,
    })
    let resolveComplete!: (value: Awaited<ReturnType<typeof accountApi.completeWebAuthnCeremony>>) => void
    completeWebAuthnCeremonyMock.mockReturnValue(
      new Promise((resolve) => {
        resolveComplete = resolve
      }),
    )
    const onAuthenticated = vi.fn()

    const { unmount } = renderCallback({ createCredential, onAuthenticated })

    await vi.waitFor(() => expect(completeWebAuthnCeremonyMock).toHaveBeenCalledTimes(1))
    unmount()

    resolveComplete({ ok: true, account: COMPLETED_ACCOUNT })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('does not throw when the ceremony succeeds without an onAuthenticated callback', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    const createCredential = vi.fn().mockResolvedValue({
      credentialId: CREDENTIAL_ID,
      clientDataJson: CLIENT_DATA_JSON,
      attestationObject: ATTESTATION_OBJECT,
    })
    const getCredential = vi.fn()
    completeWebAuthnCeremonyMock.mockResolvedValue({ ok: true, account: COMPLETED_ACCOUNT })

    renderCallback({ createCredential, getCredential })

    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Login realizado com sucesso.'))
  })

  it('falls back to the real WebAuthn browser functions when createCredential/getCredential are not overridden', async () => {
    verifyMagicLinkMock.mockResolvedValue({ ok: false, code: 'auth.magic_link_invalid', params: {} })

    render(
      <I18nProvider i18n={i18n}>
        <MagicLinkCallback baseUrl={BASE_URL} token={TOKEN} />
      </I18nProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Este link de acesso não é mais válido. Solicite um novo.',
    )
    expect(completeWebAuthnCeremonyMock).not.toHaveBeenCalled()
  })

  it('ignores a late ceremony rejection after the component unmounted', async () => {
    verifyMagicLinkMock.mockResolvedValue({
      ok: true,
      magicLinkTicket: MAGIC_LINK_TICKET,
      ceremonyType: 'Register',
      challenge: encodeBase64(CHALLENGE),
      relyingPartyId: RELYING_PARTY_ID,
      credentialId: null,
    })
    let rejectCreate!: (reason: unknown) => void
    const createCredential = vi.fn().mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject
      }),
    )

    const { unmount } = renderCallback({ createCredential })

    await vi.waitFor(() => expect(createCredential).toHaveBeenCalledTimes(1))
    unmount()

    rejectCreate(new Error('NotAllowedError'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(completeWebAuthnCeremonyMock).not.toHaveBeenCalled()
  })
})
