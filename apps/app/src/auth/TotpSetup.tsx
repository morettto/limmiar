import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { beginTotpEnrollment, confirmTotpEnrollment } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'

export interface TotpSetupProps {
  baseUrl: string
  accountId: string
  ticket: string
  onDone: () => void
}

// Wrapped in `{ status }` instead of a bare string-literal union: eslint's
// lingui/no-unlocalized-strings exemption for state-machine tags only covers the
// `status` property name, not a bare literal passed to useState/setStep.
type Step =
  | { status: 'loading' }
  | { status: 'begin-error' }
  | { status: 'enter-code' }
  | { status: 'confirming' }
  | { status: 'confirm-error' }
  | { status: 'backup-codes' }

export function TotpSetup({ baseUrl, accountId, ticket, onDone }: TotpSetupProps) {
  const { i18n } = useLingui()
  const [step, setStep] = useState<Step>({ status: 'loading' })
  const [secret, setSecret] = useState('')
  const [provisioningUri, setProvisioningUri] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [code, setCode] = useState('')

  useEffect(() => {
    let cancelled = false

    async function begin() {
      const result = await beginTotpEnrollment(baseUrl, accountId, ticket)
      if (cancelled) {
        return
      }

      if (result.ok) {
        setSecret(result.secret)
        setProvisioningUri(result.provisioningUri)
        setStep({ status: 'enter-code' })
      } else {
        setErrorMessage(translateProblemCode(result.code, result.params, i18n))
        setStep({ status: 'begin-error' })
      }
    }

    void begin()

    return () => {
      cancelled = true
    }
  }, [baseUrl, accountId, ticket, i18n])

  async function handleConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStep({ status: 'confirming' })

    const result = await confirmTotpEnrollment(baseUrl, accountId, ticket, code)

    if (result.ok) {
      setBackupCodes(result.backupCodes)
      setStep({ status: 'backup-codes' })
    } else {
      setErrorMessage(translateProblemCode(result.code, result.params, i18n))
      setStep({ status: 'confirm-error' })
    }
  }

  if (step.status === 'loading') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Preparando a verificação em duas etapas...</Trans>
        </p>
      </div>
    )
  }

  if (step.status === 'begin-error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {errorMessage}
        </p>
      </div>
    )
  }

  if (step.status === 'backup-codes') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <h2 className="mb-2 text-lg font-semibold">
          <Trans>Guarde seus códigos de backup</Trans>
        </h2>
        <p role="status" className="mb-4 text-sm text-red-700">
          <Trans>
            Estes códigos não serão exibidos novamente. Guarde-os em um local seguro: eles são a única forma de
            recuperar o acesso à sua conta caso você perca o aplicativo autenticador.
          </Trans>
        </p>
        <ul className="mb-4 grid grid-cols-2 gap-2 font-mono text-sm">
          {backupCodes.map((backupCode) => (
            <li key={backupCode} className="rounded-md border border-neutral-300 px-2 py-1">
              {backupCode}
            </li>
          ))}
        </ul>
        <button type="button" onClick={onDone} className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white">
          <Trans>Guardei meus códigos</Trans>
        </button>
      </div>
    )
  }

  const isConfirming = step.status === 'confirming'

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Configure a verificação em duas etapas</Trans>
      </h2>
      <p className="mb-2 text-sm text-neutral-600">
        <Trans>Adicione esta conta no seu aplicativo autenticador, usando as informações abaixo.</Trans>
      </p>
      <label className="mb-2 block">
        <span className="mb-1 block text-sm font-medium">
          <Trans>Código secreto</Trans>
        </span>
        <input
          type="text"
          readOnly
          value={secret}
          onFocus={(event) => event.target.select()}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
        />
      </label>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium">
          <Trans>Link de provisionamento</Trans>
        </span>
        <input
          type="text"
          readOnly
          value={provisioningUri}
          onFocus={(event) => event.target.select()}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
        />
      </label>

      <form onSubmit={(event) => void handleConfirm(event)}>
        <label className="mb-2 block">
          <span className="mb-1 block text-sm font-medium">
            <Trans>Código de 6 dígitos do aplicativo autenticador</Trans>
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>

        {step.status === 'confirm-error' ? (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <button type="submit" disabled={isConfirming} className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white">
          <Trans>Confirmar</Trans>
        </button>
      </form>
    </div>
  )
}
