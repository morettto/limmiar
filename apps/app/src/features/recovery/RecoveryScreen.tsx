import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { validateMnemonic } from '@limmiar/crypto'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import { deriveEmailSalt, deriveRecoveryVerifier, openRecoveryEnvelope, recoverAccess, type Account } from '../../entities/account'
import { TotpChallenge } from '../totp-challenge/TotpChallenge'
import { TotpSetup } from '../totp-enrollment/TotpSetup'

export interface RecoveryScreenProps {
  baseUrl: string
  onRecovered?: (account: Account, kek: CryptoKey) => void
}

type SubmitState =
  | { status: 'submitting' }
  | { status: 'error'; message: MessageDescriptor }
  | { status: 'success'; account: Account }
  | { status: 'totp-setup'; account: Account; kek: CryptoKey }
  | { status: 'totp-challenge'; account: Account; kek: CryptoKey }

export function RecoveryScreen({ baseUrl, onRecovered }: RecoveryScreenProps) {
  const { i18n } = useLingui()
  const [email, setEmail] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [state, setState] = useState<SubmitState | null>(null)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const active = useRef(true)

  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  // Stryker restore ArrayDeclaration

  function handleRecovered(account: Account, kek: CryptoKey) {
    onRecovered?.(account, kek)
    setState({ status: 'success', account })
  }

  function handleAccount(account: Account, kek: CryptoKey) {
    switch (account.twoFactorRequirement) {
      case 'SetupRequired':
        setState({ status: 'totp-setup', account, kek })
        break
      case 'ChallengeRequired':
        setState({ status: 'totp-challenge', account, kek })
        break
      case 'NotApplicable':
        handleRecovered(account, kek)
        break
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state?.status === 'submitting') return

    const trimmedMnemonic = mnemonic.trim()
    if (!validateMnemonic(trimmedMnemonic)) {
      // Keep this message generic. Naming the wrong word would let an attacker
      // brute-force the phrase one word at a time.
      setState({
        status: 'error',
        message: msg`Frase de recuperação inválida. Verifique se você digitou todas as palavras corretamente.`,
      })
      return
    }

    setState({ status: 'submitting' })
    try {
      const salt = await deriveEmailSalt(email)
      const recoveryVerifier = await deriveRecoveryVerifier(trimmedMnemonic, salt)
      if (!active.current) return
      const result = await recoverAccess(baseUrl, { email, recoveryVerifier })
      if (!active.current) return
      if (!result.ok) {
        setState({ status: 'error', message: problemMessage(result.code, result.params) })
        return
      }
      const kek = await openRecoveryEnvelope(trimmedMnemonic, email, result.account.id, result.recoveryEnvelope)
      if (!active.current) return
      // Stryker disable next-line StringLiteral: equivalent, the form unmounts right after, so the cleared phrase is never rendered.
      setMnemonic('')
      handleAccount(result.account, kek)
    } catch {
      setState({ status: 'error', message: msg`Não foi possível recuperar o acesso. Verifique sua frase e tente novamente.` })
    }
  }

  if (state?.status === 'totp-setup') {
    return (
      <TotpSetup
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onDone={(tokens) => handleRecovered({
          ...state.account, ...tokens, twoFactorRequirement: 'ChallengeRequired', twoFactorTicket: null,
        }, state.kek)}
      />
    )
  }

  if (state?.status === 'totp-challenge') {
    return (
      <TotpChallenge
        baseUrl={baseUrl}
        accountId={state.account.id}
        ticket={state.account.twoFactorTicket!}
        onVerified={(account) => handleRecovered(account, state.kek)}
      />
    )
  }

  if (state?.status === 'success') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Acesso recuperado com sucesso.</Trans>
        </p>
      </div>
    )
  }

  const isSubmitting = state?.status === 'submitting'

  return (
    <div className="mx-auto max-w-sm p-4">
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
            disabled={isSubmitting}
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
            disabled={isSubmitting}
            required
            autoComplete="off"
            spellCheck={false}
            rows={3}
            value={mnemonic}
            onChange={(event) => setMnemonic(event.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        </label>

        {state?.status === 'error' ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {i18n._(state.message)}
          </p>
        ) : null}

        <button type="submit" disabled={isSubmitting} className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white">
          <Trans>Recuperar acesso</Trans>
        </button>
      </form>
    </div>
  )
}
