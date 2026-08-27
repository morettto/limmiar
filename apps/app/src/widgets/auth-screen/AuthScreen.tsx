import { useId, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { translateProblemCode } from '../../shared/api'
import { recordSession } from '../../entities/session'
import {
  continueWithGoogle,
  deriveEmailPasswordVerifier,
  deriveEmailSalt,
  register,
  requestMagicLink,
  type Account,
  type AccountRole,
} from '../../entities/account'
import { TotpChallenge } from '../../features/totp-challenge/TotpChallenge'
import { TotpSetup } from '../../features/totp-enrollment/TotpSetup'

export interface AuthScreenProps {
  baseUrl: string
  getGoogleIdToken: () => Promise<string>
  onAuthenticated?: (account: Account) => void
  initialRole?: AccountRole
}

const DEFAULT_ROLE: AccountRole = 'Professional'

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; account: Account }
  | { status: 'magic-link-sent' }
  | { status: 'totp-setup'; account: Account }
  | { status: 'totp-challenge'; account: Account }

export function AuthScreen({ baseUrl, getGoogleIdToken, onAuthenticated, initialRole }: AuthScreenProps) {
  const { i18n, t } = useLingui()
  const roleGroupName = useId()
  const [role, setRole] = useState<AccountRole>(initialRole ?? DEFAULT_ROLE)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  function handleAuthenticated(account: Account) {
    recordSession(account)
    onAuthenticated?.(account)
    setState({ status: 'success', account })
  }

  function handleAccountResult(account: Account) {
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
    const result = await continueWithGoogle(baseUrl, { idToken, requestedRole: role })

    if (result.ok) {
      handleAccountResult(result.account)
    } else {
      handleFailure(result.code, result.params)
    }
  }

  if (state.status === 'totp-setup') {
    // twoFactorTicket is non-null here: the backend always sets it when
    // twoFactorRequirement is not 'NotApplicable'.
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
