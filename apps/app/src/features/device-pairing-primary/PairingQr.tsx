import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import QRCode from 'qrcode'
import { translateProblemCode } from '../../shared/api'
import { createPairingSession, getPairingClaimStatus, type PairingQrPayload } from '../../entities/device'

export interface PairingQrProps {
  baseUrl: string
  accountId: string
  accessToken: string
  primaryPublicKeyBase64: string
  onClaimed: (newDevicePublicKeyBase64: string, sessionId: string) => void
  onExpired?: () => void
}

const POLL_INTERVAL_MS = 1000

type PairingQrState =
  | { status: 'creating' }
  | { status: 'displaying'; sessionId: string; qrDataUrl: string; payloadText: string; expiresAt: string }
  | { status: 'claimed' }
  | { status: 'expired' }
  | { status: 'error'; message: string }

export function PairingQr({
  baseUrl,
  accountId,
  accessToken,
  primaryPublicKeyBase64,
  onClaimed,
  onExpired,
}: PairingQrProps) {
  const { i18n, t } = useLingui()
  const [state, setState] = useState<PairingQrState>({ status: 'creating' })

  useEffect(() => {
    let cancelled = false

    async function create() {
      const result = await createPairingSession(baseUrl, accountId, accessToken, primaryPublicKeyBase64)
      if (cancelled) {
        return
      }

      if (!result.ok) {
        setState({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
        return
      }

      // features/qr-scan/PairingScan.tsx parses this back out via the same entities/device type.
      const payload: PairingQrPayload = { s: result.sessionId, k: primaryPublicKeyBase64, u: baseUrl }
      const payloadText = JSON.stringify(payload)
      const qrDataUrl = await QRCode.toDataURL(payloadText)
      if (cancelled) {
        return
      }

      setState({ status: 'displaying', sessionId: result.sessionId, qrDataUrl, payloadText, expiresAt: result.expiresAt })
    }

    void create()

    return () => {
      cancelled = true
    }
  }, [baseUrl, accountId, accessToken, primaryPublicKeyBase64, i18n])

  const sessionId = state.status === 'displaying' ? state.sessionId : undefined
  const expiresAt = state.status === 'displaying' ? state.expiresAt : undefined

  useEffect(() => {
    if (sessionId === undefined || expiresAt === undefined) {
      return
    }

    const intervalId = setInterval(() => {
      if (Date.now() >= new Date(expiresAt).getTime()) {
        clearInterval(intervalId)
        setState({ status: 'expired' })
        onExpired?.()
        return
      }

      void (async () => {
        const result = await getPairingClaimStatus(baseUrl, accountId, accessToken, sessionId)

        if (!result.ok) {
          clearInterval(intervalId)
          setState({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
          return
        }

        if (result.claimed && result.newDevicePublicKey !== null) {
          clearInterval(intervalId)
          setState({ status: 'claimed' })
          onClaimed(result.newDevicePublicKey, sessionId)
        }
      })()
    }, POLL_INTERVAL_MS)

    return () => {
      clearInterval(intervalId)
    }
  }, [sessionId, expiresAt, baseUrl, accountId, accessToken, i18n, onClaimed, onExpired])

  if (state.status === 'creating') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Preparando o código para parear o novo dispositivo...</Trans>
        </p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      </div>
    )
  }

  if (state.status === 'expired') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          <Trans>Este código expirou. Volte para gerar um novo.</Trans>
        </p>
      </div>
    )
  }

  if (state.status === 'claimed') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Dispositivo pareado com sucesso.</Trans>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Parear novo dispositivo</Trans>
      </h2>
      <p className="mb-4 text-sm text-neutral-600">
        <Trans>Escaneie este código QR com o dispositivo que você quer parear.</Trans>
      </p>
      <img
        src={state.qrDataUrl}
        alt={t`Código QR para parear novo dispositivo`}
        // E2E-only: lets a test read the QR content without decoding the rendered image.
        // No production code reads this attribute.
        data-pairing-payload={state.payloadText}
        className="mx-auto h-auto w-full max-w-xs"
      />
    </div>
  )
}
