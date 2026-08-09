import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { generateMnemonic } from '@limmiar/crypto'
import { registerRecoveryPhrase } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { deriveEmailSalt } from './password-verifier'
import { deriveRecoveryVerifier } from './recovery-verifier'

export interface RecoveryPhraseSetupProps {
  /** Base URL of the Limmiar API (same convention as api/client.ts's other callers). */
  baseUrl: string
  /** The account (must be AccountRole.Professional) enrolling a recovery phrase. */
  accountId: string
  /** The account's e-mail -- deriveEmailSalt(email) must match the same salt login/register use. */
  email: string
  /** The account's bearer access token -- sent as `Authorization: Bearer` (registerRecoveryPhrase). */
  accessToken: string
  /** Called once the user has confirmed they saved their recovery phrase (the "done" button). */
  onDone: () => void
}

// BIP39 strength for the recovery phrase (packages/crypto/src/bip39.ts's Bip39Strength
// union). This is the first real call site for generateMnemonic in this repo, so there is
// no existing precedent to follow -- 256 (24 words) is chosen deliberately over the 128-bit
// minimum: a recovery phrase guards full account access the same way a password does
// (ADR-S02-02), so it gets the union's maximum strength.
const RECOVERY_PHRASE_STRENGTH_BITS = 256

// 2-step flow, deliberately simpler than TotpSetup's (no code-confirmation round trip --
// unlike a TOTP secret, there is nothing here for the user to type back to prove they wrote
// it down): generating (mnemonic generation + derivation + POST, all happen together, with
// nothing meaningful to show mid-flight) -> phrase-ready (dedicated screen, shown exactly
// once) | save-error.
type Step = { status: 'generating' } | { status: 'save-error' } | { status: 'phrase-ready' }

export function RecoveryPhraseSetup({ baseUrl, accountId, email, accessToken, onDone }: RecoveryPhraseSetupProps) {
  const { i18n } = useLingui()
  const [step, setStep] = useState<Step>({ status: 'generating' })
  const [mnemonic, setMnemonic] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function setup() {
      const generated = generateMnemonic(RECOVERY_PHRASE_STRENGTH_BITS)
      const salt = await deriveEmailSalt(email)
      const recoveryVerifier = await deriveRecoveryVerifier(generated, salt)
      const result = await registerRecoveryPhrase(baseUrl, accountId, accessToken, recoveryVerifier)
      if (cancelled) {
        return
      }

      if (result.ok) {
        setMnemonic(generated)
        setStep({ status: 'phrase-ready' })
      } else {
        setErrorMessage(translateProblemCode(result.code, result.params, i18n))
        setStep({ status: 'save-error' })
      }
    }

    void setup()

    return () => {
      cancelled = true
    }
  }, [baseUrl, accountId, email, accessToken, i18n])

  if (step.status === 'generating') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Gerando sua frase de recuperação...</Trans>
        </p>
      </div>
    )
  }

  if (step.status === 'save-error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {errorMessage}
        </p>
      </div>
    )
  }

  // Dedicated screen -- deliberately not stacked with anything else, since this phrase is
  // shown in clear text this one time only (same discipline as TotpSetup's backup-codes
  // screen). Numbered word grid, not a paragraph: recovery phrases are copy-error-prone, and
  // a numbered list is the standard UX for confirming word order and catching a missed word.
  const words = mnemonic.split(' ')

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Guarde sua frase de recuperação</Trans>
      </h2>
      <p role="status" className="mb-4 text-sm text-red-700">
        <Trans>
          Esta frase não será exibida novamente. Guarde-a em um local seguro: ela é a única forma de recuperar o
          acesso à sua conta caso você perca todos os seus dispositivos.
        </Trans>
      </p>
      <ol className="mb-4 grid grid-cols-2 gap-2 font-mono text-sm">
        {words.map((word, index) => (
          <li key={`${index}-${word}`} className="rounded-md border border-neutral-300 px-2 py-1">
            <span className="mr-1 text-neutral-400">{index + 1}.</span>
            {word}
          </li>
        ))}
      </ol>
      <button type="button" onClick={onDone} className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white">
        <Trans>Guardei minha frase</Trans>
      </button>
    </div>
  )
}
