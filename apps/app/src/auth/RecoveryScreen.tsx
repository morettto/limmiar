import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { validateMnemonic } from '@limmiar/crypto'
import { recoverAccess, type AccountResult } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { persistAccountSession } from './AuthScreen'
import { deriveEmailSalt } from './password-verifier'
import { deriveRecoveryVerifier } from './recovery-verifier'
import { TotpChallenge } from './TotpChallenge'
import { TotpSetup } from './TotpSetup'

export interface RecoveryScreenProps {
  /** Base URL of the Limmiar API (same convention as api/client.ts's other callers). */
  baseUrl: string
  /** Called once recoverAccess() (and, if applicable, the following TOTP step) succeeds. */
  onRecovered?: (account: AccountResult) => void
}

// Same status union as AuthScreen's SubmitState, minus register/Google-only states
// ('magic-link-sent'): recovery re-authenticates an existing account, so it only ever needs
// idle/submitting/error, plus AuthScreen's identical post-authentication branch into
// TotpSetup/TotpChallenge/success.
type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; account: AccountResult }
  | { status: 'totp-setup'; account: AccountResult }
  | { status: 'totp-challenge'; account: AccountResult }

export function RecoveryScreen({ baseUrl, onRecovered }: RecoveryScreenProps) {
  const { i18n, t } = useLingui()
  const [email, setEmail] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  function handleRecovered(account: AccountResult) {
    persistAccountSession(account)
    onRecovered?.(account)
    setState({ status: 'success', account })
  }

  // Same branching AuthScreen's handleAccountResult does on twoFactorRequirement -- a
  // recovered account goes through the exact same TotpSetup/TotpChallenge steps a
  // fresh register/login would.
  function handleAccountResult(account: AccountResult) {
    switch (account.twoFactorRequirement) {
      case 'SetupRequired':
        setState({ status: 'totp-setup', account })
        break
      case 'ChallengeRequired':
        setState({ status: 'totp-challenge', account })
        break
      case 'NotApplicable':
        handleRecovered(account)
        break
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedMnemonic = mnemonic.trim()
    if (!validateMnemonic(trimmedMnemonic)) {
      // Deliberately generic (explicit acceptance criterion): this must never name which
      // word is wrong, or even hint that a checksum vs. wordlist-membership problem was
      // found -- a per-word hint would let an attacker brute-force the phrase one word at a
      // time instead of needing the whole sequence at once.
      setState({
        status: 'error',
        message: t`Frase de recuperação inválida. Verifique se você digitou todas as palavras corretamente.`,
      })
      return
    }

    setState({ status: 'submitting' })

    const salt = await deriveEmailSalt(email)
    const recoveryVerifier = await deriveRecoveryVerifier(trimmedMnemonic, salt)
    const result = await recoverAccess(baseUrl, { email, recoveryVerifier })

    if (result.ok) {
      handleAccountResult(result.account)
    } else {
      // Server-side rejection (auth.invalid_recovery_phrase) is just as generic --
      // see problem-messages.ts's own doc comment on that code.
      setState({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
    }
  }

  if (state.status === 'totp-setup') {
    return (
      <TotpSetup
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onDone={() => handleRecovered(state.account)}
      />
    )
  }

  if (state.status === 'totp-challenge') {
    return (
      <TotpChallenge
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onVerified={handleRecovered}
      />
    )
  }

  if (state.status === 'success') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Acesso recuperado com sucesso.</Trans>
        </p>
      </div>
    )
  }

  const isSubmitting = state.status === 'submitting'

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Recuperar acesso à conta</Trans>
      </h2>
      <p className="mb-4 text-sm text-neutral-600">
        <Trans>Digite seu e-mail e sua frase de recuperação para recuperar o acesso à sua conta.</Trans>
      </p>

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
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">
            <Trans>Frase de recuperação</Trans>
          </span>
          <textarea
            required
            autoComplete="off"
            spellCheck={false}
            rows={3}
            value={mnemonic}
            onChange={(event) => setMnemonic(event.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        </label>

        {state.status === 'error' ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {state.message}
          </p>
        ) : null}

        <button type="submit" disabled={isSubmitting} className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white">
          <Trans>Recuperar acesso</Trans>
        </button>
      </form>
    </div>
  )
}
