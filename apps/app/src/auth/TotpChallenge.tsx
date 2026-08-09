import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { verifyTotpChallenge, type AccountResult } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'

export interface TotpChallengeProps {
  /** Base URL of the Limmiar API (same convention as api/client.ts's other callers). */
  baseUrl: string
  /** The Professional account whose TOTP enrollment is already confirmed. */
  accountId: string
  /**
   * Security-review fix: the two-factor ticket register/login/google issued for this
   * account, proving the caller already passed one of those before reaching this screen.
   * Required by verifyTotpChallenge -- see api/client.ts.
   */
  ticket: string
  /** Called once verifyTotpChallenge() succeeds, with the now-authenticated account. */
  onVerified: (account: AccountResult) => void
}

type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string }

// Single free-text field for either a 6-digit authenticator code or a
// "xxxxx-xxxxx" backup code -- simpler to build/test than two separate
// fields or tabs, and the two shapes are trivially distinguishable: exactly
// 6 digits means `code`, anything containing a hyphen means `backupCode`.
const SIX_DIGIT_CODE = /^\d{6}$/

function toTotpChallengeParams(value: string): { code: string } | { backupCode: string } {
  return SIX_DIGIT_CODE.test(value) ? { code: value } : { backupCode: value }
}

export function TotpChallenge({ baseUrl, accountId, ticket, onVerified }: TotpChallengeProps) {
  const { i18n, t } = useLingui()
  const [value, setValue] = useState('')
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState({ status: 'submitting' })

    const result = await verifyTotpChallenge(baseUrl, accountId, ticket, toTotpChallengeParams(value))

    if (result.ok) {
      onVerified(result.account)
    } else {
      setState({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
    }
  }

  const isSubmitting = state.status === 'submitting'

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Verificação em duas etapas</Trans>
      </h2>
      <p className="mb-4 text-sm text-neutral-600">
        <Trans>Digite o código de 6 dígitos do seu aplicativo autenticador ou um dos seus códigos de backup.</Trans>
      </p>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">
            <Trans>Código de verificação</Trans>
          </span>
          <input
            type="text"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t`Código ou código de backup`}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>

        {state.status === 'error' ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {state.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white"
        >
          <Trans>Verificar</Trans>
        </button>
      </form>
    </div>
  )
}
