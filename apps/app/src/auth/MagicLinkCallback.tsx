import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { completeWebAuthnCeremony, verifyMagicLink, type AccountResult } from '../api/client'
import { decodeBase64, encodeBase64 } from '../devices/base64'
import { translateProblemCode } from '../errors/problem-messages'
import { persistAccountSession } from './AuthScreen'
import {
  createCredentialWithBrowser,
  getCredentialWithBrowser,
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
  onAuthenticated?: (account: AccountResult) => void
}

type CallbackState = { status: 'in-progress' } | { status: 'success' } | { status: 'error'; message: string }

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
}: MagicLinkCallbackProps) {
  const { i18n } = useLingui()
  const [state, setState] = useState<CallbackState>({ status: 'in-progress' })

  useEffect(() => {
    let cancelled = false

    async function run() {
      const verifyResult = await verifyMagicLink(baseUrl, { token })
      if (cancelled) {
        return
      }
      if (!verifyResult.ok) {
        setState({ status: 'error', message: translateProblemCode(verifyResult.code, verifyResult.params, i18n) })
        return
      }

      const challenge = decodeBase64(verifyResult.challenge)
      let completeParams: CompleteCeremonyParams

      try {
        if (verifyResult.ceremonyType === 'Register') {
          const userId = new TextEncoder().encode(verifyResult.magicLinkTicket)
          const credential = await createCredential({
            challenge,
            relyingPartyId: verifyResult.relyingPartyId,
            userId,
            userName: verifyResult.magicLinkTicket,
          })
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
          })
          completeParams = {
            magicLinkTicket: verifyResult.magicLinkTicket,
            credentialId: encodeBase64(credential.credentialId),
            clientDataJson: encodeBase64(credential.clientDataJson),
            authenticatorData: encodeBase64(credential.authenticatorData),
            signature: encodeBase64(credential.signature),
          }
        } else {
          setState({ status: 'error', message: translateProblemCode('auth.webauthn_ceremony_failed', {}, i18n) })
          return
        }
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: translateProblemCode('auth.webauthn_ceremony_failed', {}, i18n) })
        }
        return
      }

      const completeResult = await completeWebAuthnCeremony(baseUrl, completeParams)
      if (cancelled) {
        return
      }
      if (!completeResult.ok) {
        setState({
          status: 'error',
          message: translateProblemCode(completeResult.code, completeResult.params, i18n),
        })
        return
      }

      const account: AccountResult = {
        id: completeResult.account.id,
        email: completeResult.account.email,
        role: completeResult.account.role,
        twoFactorRequirement: 'NotApplicable',
        twoFactorTicket: null,
      }
      persistAccountSession(account)
      onAuthenticated?.(account)
      setState({ status: 'success' })
    }

    void run()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {state.message}
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
