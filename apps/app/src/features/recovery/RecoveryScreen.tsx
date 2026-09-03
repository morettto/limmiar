import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { validateMnemonic } from '@limmiar/crypto'
import { translateProblemCode } from '../../shared/api'
import { deriveEmailSalt, deriveRecoveryVerifier, recoverAccess, type Account } from '../../entities/account'
import { recordSession } from '../../entities/account/session'
import { TotpChallenge } from '../totp-challenge/TotpChallenge'
import { TotpSetup } from '../totp-enrollment/TotpSetup'

export interface RecoveryScreenProps {
  baseUrl: string
  onRecovered?: (account: Account) => void
}

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; account: Account }
  | { status: 'totp-setup'; account: Account }
  | { status: 'totp-challenge'; account: Account }

export function RecoveryScreen({ baseUrl, onRecovered }: RecoveryScreenProps) {
  const { i18n, t } = useLingui()
  const [email, setEmail] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  function handleRecovered(account: Account) {
    recordSession(account)
    onRecovered?.(account)
    setState({ status: 'success', account })
  }

  function handleAccount(account: Account) {
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
      // Keep this message generic. Naming the wrong word would let an attacker
      // brute-force the phrase one word at a time.
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
      handleAccount(result.account)
    } else {
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
