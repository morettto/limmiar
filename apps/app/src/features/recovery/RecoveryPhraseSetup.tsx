import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { generateMnemonic } from '@limmiar/crypto'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'
import { createRecoveryEnvelope, deriveEmailSalt, deriveRecoveryVerifier, registerRecoveryPhrase } from '../../entities/account'

export interface RecoveryPhraseSetupProps {
  baseUrl: string
  accountId: string
  email: string
  accessToken: string
  kek: CryptoKey
  onDone: () => void
}

// A recovery phrase guards full account access, the same as a password. It gets the
// strongest BIP39 option (256 bits, 24 words) instead of the 128-bit minimum.
const RECOVERY_PHRASE_STRENGTH_BITS = 256

type Phrase = { mnemonic: string; verifier: Uint8Array; envelope: Uint8Array }
type Step = { status: 'password' } | { status: 'generating' } | { status: 'phrase-ready'; phrase: Phrase } | { status: 'saving'; phrase: Phrase }

export function RecoveryPhraseSetup({ baseUrl, accountId, email, accessToken, kek, onDone }: RecoveryPhraseSetupProps) {
  const { i18n } = useLingui()
  const [step, setStep] = useState<Step>({ status: 'password' })
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<Texto | null>(null)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const active = useRef(true)

  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  // Stryker restore ArrayDeclaration

  async function generate(event: React.FormEvent) {
    event.preventDefault()
    setStep({ status: 'generating' })
    setErrorMessage(null)
    const currentPassword = password
    setPassword('')
    try {
      const generated = generateMnemonic(RECOVERY_PHRASE_STRENGTH_BITS)
      const envelope = await createRecoveryEnvelope(currentPassword, email, accountId, generated, kek)
      const salt = await deriveEmailSalt(email)
      const verifier = await deriveRecoveryVerifier(generated, salt)
      // Stryker disable next-line StringLiteral: equivalent, the final return renders any step left after the early returns.
      setStep({ status: 'phrase-ready', phrase: { mnemonic: generated, verifier, envelope } })
    } catch {
      setErrorMessage(msg`Não foi possível proteger a chave. Verifique sua senha e tente novamente.`)
      setStep({ status: 'password' })
    }
  }

  async function save(phrase: Phrase) {
    setStep({ status: 'saving', phrase })
    setErrorMessage(null)
    try {
      const result = await registerRecoveryPhrase(baseUrl, accountId, accessToken, phrase.verifier, phrase.envelope)
      if (!active.current) return
      if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
      onDone()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : msg`Não foi possível conectar. Tente novamente.`)
      // Stryker disable next-line StringLiteral: equivalent, the final return renders any step left after the early returns.
      setStep({ status: 'phrase-ready', phrase })
    }
  }

  if (step.status === 'password') {
    return <section className="mx-auto max-w-sm p-4">
      <h2><Trans>Proteger o acesso aos prontuários</Trans></h2>
      <p><Trans>Confirme sua senha para criar uma frase que também recupera seus prontuários. Guarde a frase e seus códigos de backup do segundo fator.</Trans></p>
      <form onSubmit={(event) => void generate(event)}>
        <label><Trans>Senha atual</Trans><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {errorMessage !== null && <p role="alert">{traduzir(i18n, errorMessage)}</p>}
        <button type="submit"><Trans>Gerar frase de recuperação</Trans></button>
      </form>
    </section>
  }

  if (step.status === 'generating') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Gerando sua frase de recuperação...</Trans>
        </p>
      </div>
    )
  }

  const words = step.phrase.mnemonic.split(' ')

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Guarde sua frase de recuperação</Trans>
      </h2>
      <p role="status" className="mb-4 text-sm text-red-700">
        <Trans>
          Guarde esta frase em um local seguro. Você também precisará do segundo fator ou de um código de backup para recuperar o acesso.
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
      {errorMessage !== null && <p role="alert">{traduzir(i18n, errorMessage)}</p>}
      <button type="button" disabled={step.status === 'saving'} onClick={() => void save(step.phrase)} className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white">
        <Trans>Guardei minha frase</Trans>
      </button>
    </div>
  )
}
