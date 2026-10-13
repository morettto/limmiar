import { useId, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import {
  continueWithGoogle,
  deriveEmailPasswordVerifier,
  deriveEmailSalt,
  deriveAccountKek,
  login,
  register,
  type Account,
  type AccountRole,
} from '../../entities/account'
import { TotpChallenge } from '../../features/totp-challenge/TotpChallenge'
import { MagicLinkCallback } from '../../features/magic-link-auth/MagicLinkCallback'
import { TotpSetup } from '../../features/totp-enrollment/TotpSetup'

export interface AuthScreenProps {
  baseUrl: string
  getGoogleIdToken?: () => Promise<string>
  onAuthenticated?: (account: Account, kek?: CryptoKey) => void
  initialRole?: AccountRole
}

const DEFAULT_ROLE: AccountRole = 'Professional'

type SubmitState =
  | { status: 'submitting' }
  | { status: 'error'; message: MessageDescriptor }
  | { status: 'success'; account: Account }
  | { status: 'patient-invitation'; token: string }
  | { status: 'totp-setup'; account: Account }
  | { status: 'totp-challenge'; account: Account }

export function AuthScreen({ baseUrl, getGoogleIdToken, onAuthenticated, initialRole }: AuthScreenProps) {
  const { i18n, t } = useLingui()
  const roleGroupName = useId()
  const [role, setRole] = useState<AccountRole>(initialRole ?? DEFAULT_ROLE)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invitation, setInvitation] = useState('')
  const [mode, setMode] = useState<{ status: 'register' | 'login' }>({ status: 'register' })
  const [kek, setKek] = useState<CryptoKey | undefined>()
  const [state, setState] = useState<SubmitState | null>(null)

  function handleAuthenticated(account: Account, key?: CryptoKey) {
    if (key === undefined) onAuthenticated?.(account)
    else onAuthenticated?.(account, key)
    setState({ status: 'success', account })
  }

  function handleAccountResult(account: Account, key?: CryptoKey) {
    if (account.role !== 'Professional' || account.email === null) {
      setState({ status: 'error', message: problemMessage('unexpected_error', {}) })
      return
    }
    setKek(key)
    switch (account.twoFactorRequirement) {
      case 'SetupRequired':
        setState({ status: 'totp-setup', account })
        break
      case 'ChallengeRequired':
        setState({ status: 'totp-challenge', account })
        break
      case 'NotApplicable':
        handleAuthenticated(account, key)
        break
    }
  }

  function handleFailure(code: string, params: Record<string, string>) {
    setState({ status: 'error', message: problemMessage(code, params) })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState({ status: 'submitting' })
    try {
    if (role === 'Patient') {
      setState({ status: 'patient-invitation', token: invitation.trim().toUpperCase() })
      return
    }

    const salt = await deriveEmailSalt(email)
    const passwordVerifier = await deriveEmailPasswordVerifier(password, salt)
    const result = mode.status === 'login'
      ? await login(baseUrl, { email, passwordVerifier })
      : await register(baseUrl, { email, passwordVerifier, role })

    if (result.ok) {
      const key = await deriveAccountKek(password, email)
      setPassword('')
      handleAccountResult(result.account, key)
    } else {
      handleFailure(result.code, result.params)
    }
    } catch {
      setState({ status: 'error', message: msg`Não foi possível conectar. Tente novamente.` })
    }
  }

  async function handleGoogleClick(getToken: () => Promise<string>) {
    setState({ status: 'submitting' })
    try {
    const idToken = await getToken()
    const result = await continueWithGoogle(baseUrl, { idToken, requestedRole: role })

    if (result.ok) {
      handleAccountResult(result.account)
    } else {
      handleFailure(result.code, result.params)
    }
    } catch {
      setState({ status: 'error', message: msg`Não foi possível continuar com o Google. Tente novamente.` })
    }
  }

  if (state?.status === 'totp-setup') {
    // twoFactorTicket is non-null here: the backend always sets it when
    // twoFactorRequirement is not 'NotApplicable'.
    return (
      <TotpSetup
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onDone={(tokens) => handleAuthenticated({
          ...state.account, ...tokens, twoFactorRequirement: 'ChallengeRequired', twoFactorTicket: null,
        }, kek)}
      />
    )
  }

  if (state?.status === 'totp-challenge') {
    return (
      <TotpChallenge
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onVerified={(account) => handleAuthenticated(account, kek)}
      />
    )
  }

  if (state?.status === 'patient-invitation') return <MagicLinkCallback baseUrl={baseUrl} token={state.token} onAuthenticated={handleAuthenticated} />

  const isSubmitting = state?.status === 'submitting'

  return (
    <div className="mx-auto max-w-sm p-4">
      {role === 'Professional' ? (
        <div className="mb-4 flex gap-4">
          <button type="button" disabled={isSubmitting} aria-pressed={mode.status === 'login'}
            onClick={() => { setMode({ status: 'login' }); setState(null) }}>
            <Trans>Entrar</Trans>
          </button>
          <button type="button" disabled={isSubmitting} aria-pressed={mode.status === 'register'}
            onClick={() => { setMode({ status: 'register' }); setState(null) }}>
            <Trans>Cadastrar</Trans>
          </button>
        </div>
      ) : null}
      {state?.status === 'success' ? (
        <p role="status">
          <Trans>Conta criada. Você está cadastrado como profissional.</Trans>
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
        {role === 'Patient' ? <label className="mb-4 block">
          <span><Trans>Código de acesso recebido do profissional</Trans></span>
          <input required autoComplete="off" value={invitation} onChange={(event) => setInvitation(event.target.value)} />
        </label> : <label className="mb-2 block">
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
        </label>}
        {role === 'Professional' ? (
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium">
              <Trans>Senha</Trans>
            </span>
            <input
              type="password"
              required
              autoComplete={mode.status === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
        ) : null}

        {state?.status === 'error' ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {i18n._(state.message)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mb-2 w-full rounded-md bg-neutral-900 px-4 py-2 text-white"
        >
          {role === 'Professional'
            ? mode.status === 'login' ? <Trans>Acessar conta</Trans> : <Trans>Criar conta</Trans>
            : <Trans>Continuar com meu código</Trans>}
        </button>
        {role === 'Professional' && getGoogleIdToken !== undefined ? (
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void handleGoogleClick(getGoogleIdToken)}
          className="w-full rounded-md border border-neutral-300 px-4 py-2"
        >
          <Trans>Continuar com o Google</Trans>
        </button>
        ) : null}
      </form>
    </div>
  )
}
