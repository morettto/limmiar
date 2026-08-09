import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import QRCode from 'qrcode'
import { createPairingSession, getPairingClaimStatus } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'

export interface PairingQrProps {
  /** Base URL of the Limmiar API (same convention as api/client.ts's other callers). */
  baseUrl: string
  /** The already-authenticated account pairing a new device to itself. */
  accountId: string
  /** The primary device's own bearer access token, forwarded to the pairing-session calls. */
  accessToken: string
  /**
   * The text to encode in the QR -- already-built by the caller (slice 6 builds this from
   * the session + a locally-generated X25519 public key). This component does NOT know about
   * crypto; it just displays whatever string it's given as a QR code and manages the
   * create -> poll-for-claim -> (bubble the claim up) lifecycle via the client.ts calls.
   */
  primaryPublicKeyBase64: string
  /** Called once the new device has claimed the session, with its public key and the session id. */
  onClaimed: (newDevicePublicKeyBase64: string, sessionId: string) => void
  /** Called once the session's expiresAt has passed with no claim. */
  onExpired?: () => void
}

const POLL_INTERVAL_MS = 1000

// Wrapped in `{ status }` (same shape as AuthScreen/TotpSetup/TotpChallenge's state
// unions) rather than a bare string-literal union -- see TotpSetup.tsx's comment on why
// that's this codebase's convention even though these tags are never rendered as-is.
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

      // The new device's scanner (PairingScan.tsx) parses this back out as { s, k, u }.
      const payloadText = JSON.stringify({ s: result.sessionId, k: primaryPublicKeyBase64, u: baseUrl })
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

  // Derived (not read off `state` inside the effect below) so the effect's dependency
  // array can name the exact primitives that start/restart polling, instead of the whole
  // `state` object -- a `useState` setter call elsewhere in this component (there is none
  // that fires during 'displaying' besides this same effect's own terminal transitions)
  // would otherwise be indistinguishable from "the session actually changed".
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
        // data-pairing-payload: the raw text encoded into the QR image above, verbatim --
        // not itself sensitive (session id + two public keys, no KEK material), and the only
        // way for an automated test to recover what a rendered QR image encodes without
        // actually running a decoder against pixels. E2E-only seam (S02-04 slice 7); no
        // production code reads this attribute.
        data-pairing-payload={state.payloadText}
        className="mx-auto h-auto w-full max-w-xs"
      />
    </div>
  )
}
