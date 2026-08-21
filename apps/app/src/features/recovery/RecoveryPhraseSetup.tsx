import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { generateMnemonic } from '@limmiar/crypto'
import { translateProblemCode } from '../../shared/api'
import { deriveEmailSalt, deriveRecoveryVerifier, registerRecoveryPhrase } from '../../entities/account'

export interface RecoveryPhraseSetupProps {
  baseUrl: string
  accountId: string
  email: string
  accessToken: string
  onDone: () => void
}

// A recovery phrase guards full account access, the same as a password. It gets the
// strongest BIP39 option (256 bits, 24 words) instead of the 128-bit minimum.
const RECOVERY_PHRASE_STRENGTH_BITS = 256

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
