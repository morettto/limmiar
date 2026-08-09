import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { decrypt, deriveChannelKey, getSharedSecret, generateKeyPair } from '@limmiar/crypto'
import { fetchPairingPayload } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { decodeBase64, encodeBase64 } from './base64'
import { PairingScan } from './PairingScan'

export interface PairNewDeviceProps {
  baseUrl: string
  /** Test/production seam, forwarded straight through to PairingScan -- see qr-decode.ts. */
  decode?: () => Promise<string>
  /**
   * Called once this device holds a decrypted, working copy of the account's KEK. The
   * caller is expected to adopt it into its own Keychain, e.g.
   * `createKeychain().unlock(() => Promise.resolve(kek))` -- this component does not touch
   * Keychain itself, matching PairPrimaryDevice.tsx's symmetric choice not to reach into it
   * either.
   */
  onKekAdopted: (kek: Uint8Array) => void
}

// The payload endpoint collapses "primary hasn't submitted yet" and "session
// gone/expired/already consumed" into the same 404 (ProblemCodes.DevicePairingPayloadNotDelivered
// -- see DevicePairingEndpoints.cs), on purpose, so callers can't distinguish "keep polling"
// from "give up" by response shape. A bounded wait, matching the backend's own
// PairingSessionLifetime (2 minutes -- see DevicePairingIssuer.cs), is what stands in for
// that distinction here: still-live sessions succeed well within it, and there is no
// legitimate reason to poll past the window the session could ever have been alive for.
const PAYLOAD_POLL_INTERVAL_MS = 1000
const PAYLOAD_POLL_TIMEOUT_MS = 2 * 60 * 1000

type AdoptionState =
  | { status: 'awaiting-scan' }
  | { status: 'awaiting-payload' }
  | { status: 'adopted' }
  | { status: 'error'; message: string }

/**
 * Wires PairingScan's relay-only handshake to the actual secure channel: generates this
 * device's ephemeral X25519 keypair, hands PairingScan the public half to claim the scanned
 * session with, and -- once claimed -- polls for the primary's encrypted payload, derives
 * the same channel key the primary derived (HKDF-SHA256 over the shared ECDH secret,
 * salted with the session id), and decrypts the KEK.
 */
export function PairNewDevice({ baseUrl, decode, onKekAdopted }: PairNewDeviceProps) {
  const { i18n, t } = useLingui()
  const [keyPair] = useState(() => generateKeyPair())
  const [state, setState] = useState<AdoptionState>({ status: 'awaiting-scan' })
  const channelRef = useRef<{ sessionId: string; channelKey: Uint8Array } | null>(null)

  useEffect(() => {
    if (state.status !== 'awaiting-payload' || channelRef.current === null) {
      return
    }
    const { sessionId, channelKey } = channelRef.current
    const salt = new TextEncoder().encode(sessionId)
    const deadline = Date.now() + PAYLOAD_POLL_TIMEOUT_MS
    let cancelled = false

    async function poll() {
      const result = await fetchPairingPayload(baseUrl, sessionId)
      if (cancelled) {
        return
      }

      if (result.ok) {
        try {
          const kek = decrypt(channelKey, decodeBase64(result.encryptedKek), salt)
          setState({ status: 'adopted' })
          onKekAdopted(kek)
        } catch {
          setState({
            status: 'error',
            message: t`Não foi possível decifrar a chave recebida. Tente parear novamente.`,
          })
        }
        return
      }

      if (Date.now() >= deadline) {
        setState({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
        return
      }

      setTimeout(() => void poll(), PAYLOAD_POLL_INTERVAL_MS)
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [state.status, baseUrl, i18n, t, onKekAdopted])

  function handleClaimed(primaryPublicKeyBase64: string, sessionId: string) {
    const primaryPublicKey = decodeBase64(primaryPublicKeyBase64)
    const sharedSecret = getSharedSecret(keyPair.privateKey, primaryPublicKey)
    const channelKey = deriveChannelKey(sharedSecret, new TextEncoder().encode(sessionId))
    channelRef.current = { sessionId, channelKey }
    setState({ status: 'awaiting-payload' })
  }

  if (state.status === 'awaiting-payload') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Aguardando o outro dispositivo enviar a chave...</Trans>
        </p>
      </div>
    )
  }

  if (state.status === 'adopted') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Dispositivo pareado com sucesso.</Trans>
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

  return (
    <PairingScan
      decode={decode}
      newDevicePublicKeyBase64={encodeBase64(keyPair.publicKey)}
      onClaimed={handleClaimed}
    />
  )
}
