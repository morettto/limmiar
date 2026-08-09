import { useId, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { continueWithGoogle, register, requestMagicLink, type AccountResult, type AccountRole } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { deriveEmailPasswordVerifier, deriveEmailSalt } from './password-verifier'
import { TotpChallenge } from './TotpChallenge'
import { TotpSetup } from './TotpSetup'

export interface AuthScreenProps {
  /** Base URL of the Limmiar API (same convention as api/client.ts's other callers). */
  baseUrl: string
  /**
   * Not a pre-agreed seam: S02-01's confirmed backend contract only covers
   * POST /auth/google itself (idToken in, account out) -- how a real Google
   * ID token gets obtained in the browser (Google Identity Services SDK
   * loading, popup/One Tap flow, etc.) is a separate integration with no ADR
   * yet. Accepting it as an injected callback keeps AuthScreen decoupled
   * from that SDK and directly testable; the real implementation is the
   * caller's job once that integration lands.
   */
  getGoogleIdToken: () => Promise<string>
  /** Called once register()/continueWithGoogle() succeeds. Optional -- see the session-storage note below for the default persistence AuthScreen does on its own. */
  onAuthenticated?: (account: AccountResult) => void
  /**
   * Overrides the pre-selected segment (see `DEFAULT_ROLE`'s own doc comment). Optional --
   * every real caller wants the product default. Exists for magic-link-login.spec.ts (S02-05):
   * that E2E asserts a password `<input>` never renders anywhere in the Patient magic-link
   * flow's DOM, which the Professional-first default would falsify for a moment on first
   * paint even though the test immediately clicks "Paciente" -- landing directly on the
   * Patient segment is also the more realistic simulation of a returning patient's deep link,
   * once one exists.
   */
  initialRole?: AccountRole
}

const ACCOUNT_SESSION_STORAGE_KEY = 'limmiar:account'

// ADR-S02-01's segmented control default -- "profissional" is listed first
// in the ticket's own wording, so it's the pre-selected segment.
const DEFAULT_ROLE: AccountRole = 'Professional'

// Design note (not a pre-agreed seam): the backend issues no session/token
// yet (that's S02-08's job), so there is nothing richer to store client-side
// than the account the last successful register/login/Google call returned.
// sessionStorage (not localStorage) is the simplest reasonable choice for
// "later screens in THIS session can read who just signed up" without
// building actual session persistence ahead of the ticket that owns it.
export function persistAccountSession(account: AccountResult): void {
  window.sessionStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(account))
}

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; account: AccountResult }
  | { status: 'magic-link-sent' }
  // Professional accounts never reach 'success' directly (Spec S02,
  // ADR-S02-03/S02-04): a fresh registration/Google sign-up with no confirmed
  // TOTP enrollment routes through 'totp-setup' first, and one that already
  // has 2FA confirmed routes through 'totp-challenge' -- handleAuthenticated
  // (and thus onAuthenticated/session persistence/'success') only runs once
  // one of those completes.
  | { status: 'totp-setup'; account: AccountResult }
  | { status: 'totp-challenge'; account: AccountResult }

export function AuthScreen({ baseUrl, getGoogleIdToken, onAuthenticated, initialRole }: AuthScreenProps) {
  const { i18n, t } = useLingui()
  const roleGroupName = useId()
  const [role, setRole] = useState<AccountRole>(initialRole ?? DEFAULT_ROLE)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  function handleAuthenticated(account: AccountResult) {
    persistAccountSession(account)
    onAuthenticated?.(account)
    setState({ status: 'success', account })
  }

  // Routes a just-registered/just-signed-in account per its
  // twoFactorRequirement (Spec S02, ADR-S02-03/S02-04) instead of treating
  // register()/continueWithGoogle() success as immediately authenticated.
  function handleAccountResult(account: AccountResult) {
    switch (account.twoFactorRequirement) {
      case 'SetupRequired':
        setState({ status: 'totp-setup', account })
        break
      case 'ChallengeRequired':
        setState({ status: 'totp-challenge', account })
        break
      case 'NotApplicable':
        handleAuthenticated(account)
        break
    }
  }

  function handleFailure(code: string, params: Record<string, string>) {
    setState({ status: 'error', message: translateProblemCode(code, params, i18n) })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState({ status: 'submitting' })

    if (role === 'Patient') {
      const result = await requestMagicLink(baseUrl, { email })
      if (result.ok) {
        setState({ status: 'magic-link-sent' })
      } else {
        handleFailure(result.code, result.params)
      }
      return
    }

    const salt = await deriveEmailSalt(email)
    const passwordVerifier = await deriveEmailPasswordVerifier(password, salt)
    const result = await register(baseUrl, { email, passwordVerifier, role })

    if (result.ok) {
      handleAccountResult(result.account)
    } else {
      handleFailure(result.code, result.params)
    }
  }

  async function handleGoogleClick() {
    setState({ status: 'submitting' })

    const idToken = await getGoogleIdToken()
    // ADR-S02-01: requestedRole only takes effect when the Google identity's
    // e-mail has no existing account; otherwise the backend's response.role
    // wins and is used as-is below -- this screen never asks again.
    const result = await continueWithGoogle(baseUrl, { idToken, requestedRole: role })

    if (result.ok) {
      handleAccountResult(result.account)
    } else {
      handleFailure(result.code, result.params)
    }
  }

  if (state.status === 'totp-setup') {
    // Non-null assertion: handleAccountResult only reaches 'totp-setup' when
    // twoFactorRequirement is 'SetupRequired', and the backend guarantees a non-null
    // twoFactorTicket whenever twoFactorRequirement isn't 'NotApplicable' (security-review
    // fix -- see api/client.ts's AccountResult doc comment).
    return (
      <TotpSetup
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onDone={() => handleAuthenticated(state.account)}
      />
    )
  }

  if (state.status === 'totp-challenge') {
    return (
      <TotpChallenge
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onVerified={handleAuthenticated}
      />
    )
  }

  if (state.status === 'magic-link-sent') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Verifique seu e-mail para continuar. Enviamos um link de acesso, se este e-mail existir.</Trans>
        </p>
      </div>
    )
  }

  const isSubmitting = state.status === 'submitting'

  return (
    <div className="mx-auto max-w-sm p-4">
      {state.status === 'success' ? (
        <p role="status">
          {state.account.role === 'Professional' ? (
            <Trans>Conta criada. Você está cadastrado como profissional.</Trans>
          ) : (
            <Trans>Conta criada. Você está cadastrado como paciente.</Trans>
          )}
        </p>
      ) : null}

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-medium">
          <Trans>Como você vai usar o Limmiar?</Trans>
        </legend>
        <div role="radiogroup" aria-label={t`Tipo de conta`} className="flex gap-2">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={roleGroupName}
              value="Professional"
              checked={role === 'Professional'}
              onChange={() => setRole('Professional')}
            />
            <Trans>Profissional</Trans>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={roleGroupName}
              value="Patient"
              checked={role === 'Patient'}
              onChange={() => setRole('Patient')}
            />
            <Trans>Paciente</Trans>
          </label>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          {role === 'Professional' ? (
            <Trans>Gerencie pacientes, prontuários e agenda em um só lugar.</Trans>
          ) : (
            <Trans>Acompanhe suas consultas e informações de saúde com segurança.</Trans>
          )}
        </p>
      </fieldset>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-medium">
            <Trans>E-mail</Trans>
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>
        {role === 'Professional' ? (
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium">
              <Trans>Senha</Trans>
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
        ) : null}

        {state.status === 'error' ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mb-2 w-full rounded-md bg-neutral-900 px-4 py-2 text-white"
        >
          {role === 'Professional' ? <Trans>Criar conta</Trans> : <Trans>Enviar link mágico</Trans>}
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void handleGoogleClick()}
          className="w-full rounded-md border border-neutral-300 px-4 py-2"
        >
          <Trans>Continuar com o Google</Trans>
        </button>
      </form>
    </div>
  )
}
