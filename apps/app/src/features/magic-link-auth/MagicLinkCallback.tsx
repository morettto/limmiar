import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from '@tanstack/react-router'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { completeWebAuthnCeremony, verifyMagicLink, type Account } from '../../entities/account'
import {
  createCredentialWithBrowser,
  getCredentialWithBrowser,
  PasskeySemCifraError,
  type WebAuthnAssertionCredential,
  type WebAuthnAssertionInput,
  type WebAuthnRegistrationCredential,
  type WebAuthnRegistrationInput,
} from './webauthn'

export interface MagicLinkCallbackProps {
  baseUrl: string
  token: string
  createCredential?: (input: WebAuthnRegistrationInput) => Promise<WebAuthnRegistrationCredential>
  getCredential?: (input: WebAuthnAssertionInput) => Promise<WebAuthnAssertionCredential>
  onAuthenticated?: (account: Account, kek: CryptoKey) => void
  patientAccountId?: string
}

type CallbackState = { status: 'in-progress' } | { status: 'success' } | { status: 'error'; message: MessageDescriptor }

interface CompleteCeremonyParams {
  magicLinkTicket: string
  credentialId: string
  clientDataJson: string
  attestationObject?: string
  authenticatorData?: string
  signature?: string
}

export function MagicLinkCallback({
  baseUrl,
  token,
  createCredential = createCredentialWithBrowser,
  getCredential = getCredentialWithBrowser,
  onAuthenticated,
  patientAccountId,
}: MagicLinkCallbackProps) {
  const { i18n } = useLingui()
  const [state, setState] = useState<CallbackState>({ status: 'in-progress' })
  const [authenticatedId, setAuthenticatedId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [existingId, setExistingId] = useState(patientAccountId ?? '')

  useEffect(() => {
    if (!started) return
    let cancelled = false
    const controller = new AbortController()

    async function run() {
      const verifyResult = await verifyMagicLink(baseUrl, { token, ...(existingId.trim() ? { patientAccountId: existingId.trim() } : {}) })
      if (cancelled) {
        return
      }
      if (!verifyResult.ok) {
        setState({ status: 'error', message: problemMessage(verifyResult.code, verifyResult.params) })
        return
      }

      const challenge = decodeBase64(verifyResult.challenge)
      let completeParams: CompleteCeremonyParams
      let kek: CryptoKey

      try {
        if (verifyResult.ceremonyType === 'Register') {
          const userId = new TextEncoder().encode(verifyResult.accountId)
          const credential = await createCredential({
            challenge,
            relyingPartyId: verifyResult.relyingPartyId,
            userId,
            userName: verifyResult.accountId,
            signal: controller.signal,
          })
          kek = credential.kek
          completeParams = {
            magicLinkTicket: verifyResult.magicLinkTicket,
            credentialId: encodeBase64(credential.credentialId),
            clientDataJson: encodeBase64(credential.clientDataJson),
            attestationObject: encodeBase64(credential.attestationObject),
          }
        } else if (verifyResult.credentialId !== null) {
          const credentialId = decodeBase64(verifyResult.credentialId)
          const credential = await getCredential({
            challenge,
            relyingPartyId: verifyResult.relyingPartyId,
            credentialId,
            signal: controller.signal,
          })
          kek = credential.kek
          completeParams = {
            magicLinkTicket: verifyResult.magicLinkTicket,
            credentialId: encodeBase64(credential.credentialId),
            clientDataJson: encodeBase64(credential.clientDataJson),
            authenticatorData: encodeBase64(credential.authenticatorData),
            signature: encodeBase64(credential.signature),
          }
        } else {
          setState({ status: 'error', message: problemMessage('auth.webauthn_ceremony_failed', {}) })
          return
        }
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof PasskeySemCifraError
            ? msg`Esta chave de acesso não permite desbloquear seus dados cifrados. Escolha outra chave de acesso.`
            : problemMessage('auth.webauthn_ceremony_failed', {}) })
        }
        return
      }

      if (cancelled) return
      const completeResult = await completeWebAuthnCeremony(baseUrl, completeParams)
      if (cancelled) {
        return
      }
      if (!completeResult.ok) {
        setState({
          status: 'error',
          message: problemMessage(completeResult.code, completeResult.params),
        })
        return
      }

      const account: Account = {
        ...completeResult.account,
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      }
      if (account.role !== 'Patient' || account.email !== null || account.id !== verifyResult.accountId) throw new Error('Invalid anonymous patient account')
      onAuthenticated?.(account, kek)
      setAuthenticatedId(account.id)
      setState({ status: 'success' })
    }

    void run().catch(() => {
      if (!cancelled) setState({ status: 'error', message: problemMessage('unexpected_error', {}) })
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [started])

  if (!started) return <section className="workspace-card mx-auto max-w-sm">
    <h2><Trans>Acesso privado do paciente</Trans></h2>
    <p><Trans>Confirme com sua chave de acesso. Seu nome e contato não serão solicitados.</Trans></p>
    <form onSubmit={(event) => { event.preventDefault(); setStarted(true) }}>
      <label><Trans>Já tem um ID no Limmiar? Informe para usar a mesma conta.</Trans>
        <input value={existingId} onChange={(event) => setExistingId(event.target.value)} autoComplete="off"
          pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" />
      </label>
      <button type="submit" className="button-primary"><Trans>Confirmar meu acesso</Trans></button>
    </form>
  </section>

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {i18n._(state.message)}
        </p>
      </div>
    )
  }

  if (state.status === 'success') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Login realizado com sucesso.</Trans>
        </p>
        <p><Trans>Seu ID no Limmiar</Trans>{': '}{authenticatedId}</p>
        <Link to="/hoje"><Trans>Abrir meu acompanhamento</Trans></Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      <p role="status">
        <Trans>Confirmando seu acesso...</Trans>
      </p>
    </div>
  )
}
