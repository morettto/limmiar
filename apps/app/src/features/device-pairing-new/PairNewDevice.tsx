import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { decrypt, deriveChannelKey, getSharedSecret, generateKeyPair } from '@limmiar/crypto'
import { translateProblemCode } from '../../shared/api'
import { fetchPairingPayload } from '../../entities/device'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { PairingScan } from '../qr-scan/PairingScan'

export interface PairNewDeviceProps {
  baseUrl: string
  decode?: () => Promise<string>
  onKekAdopted: (kek: Uint8Array) => void
}

// The payload endpoint returns the same 404 whether the primary hasn't submitted yet or
// the session is gone, so callers cannot distinguish "keep polling" from "give up" by
// response shape. The timeout below must match the backend's PairingSessionLifetime (2
// minutes): a session cannot succeed after that window closes.
const PAYLOAD_POLL_INTERVAL_MS = 1000
const PAYLOAD_POLL_TIMEOUT_MS = 2 * 60 * 1000

type AdoptionState =
  | { status: 'awaiting-scan' }
  | { status: 'awaiting-payload' }
  | { status: 'adopted' }
  | { status: 'error'; message: string }

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
