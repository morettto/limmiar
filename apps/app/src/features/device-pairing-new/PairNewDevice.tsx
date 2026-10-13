import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { decrypt, generateKeyPair } from '@limmiar/crypto'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import { fetchPairingPayload } from '../../entities/device'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import { PairingScan } from '../qr-scan/PairingScan'
import { preparePairingChannel } from '../../entities/device/pairing-channel'

export interface PairNewDeviceProps {
  baseUrl: string
  decode?: () => Promise<string>
  onKekAdopted: (kek: Uint8Array) => void | Promise<void>
}

// The payload endpoint returns the same 404 whether the primary has not submitted yet or the
// session is gone, so callers cannot tell "keep polling" from "give up" by shape. The timeout must
// match the backend's PairingSessionLifetime (2 minutes).
const PAYLOAD_POLL_INTERVAL_MS = 1000
const PAYLOAD_POLL_TIMEOUT_MS = 2 * 60 * 1000

type AdoptionState =
  | { status: 'awaiting-payload'; code: string }
  | { status: 'adopted' }
  | { status: 'error'; message: MessageDescriptor }

export function PairNewDevice({ baseUrl, decode, onKekAdopted }: PairNewDeviceProps) {
  const { i18n } = useLingui()
  const [keyPair] = useState(() => generateKeyPair())
  const [state, setState] = useState<AdoptionState | null>(null)
  const channelRef = useRef<{ sessionId: string; channelKey: Uint8Array } | null>(null)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const active = useRef(true)
  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    active.current = true
    return () => { active.current = false; channelRef.current?.channelKey.fill(0); channelRef.current = null }
  }, [])
  // Stryker restore ArrayDeclaration

  useEffect(() => {
    if (state?.status !== 'awaiting-payload') {
      return
    }
    const { sessionId, channelKey } = channelRef.current!
    const salt = new TextEncoder().encode(sessionId)
    const deadline = Date.now() + PAYLOAD_POLL_TIMEOUT_MS
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      let result: Awaited<ReturnType<typeof fetchPairingPayload>>
      try { result = await fetchPairingPayload(baseUrl, sessionId) }
      catch {
        if (!cancelled) {
          channelKey.fill(0)
          setState({ status: 'error', message: msg`Não foi possível concluir o pareamento com segurança. Tente novamente.` })
        }
        return
      }
      if (cancelled) {
        return
      }

      if (result.ok) {
        try {
          const kek = decrypt(channelKey, decodeBase64(result.encryptedKek), salt)
          try {
            if (kek.length !== 32) throw new RangeError()
            await onKekAdopted(kek)
            if (!cancelled) setState({ status: 'adopted' })
          } finally { kek.fill(0) }
        } catch {
          if (!cancelled) setState({
            status: 'error',
            message: msg`Não foi possível decifrar a chave recebida. Tente parear novamente.`,
          })
        } finally { channelKey.fill(0) }
        return
      }

      if (Date.now() >= deadline) {
        channelKey.fill(0)
        setState({ status: 'error', message: problemMessage(result.code, result.params) })
        return
      }

      timer = setTimeout(() => void poll(), PAYLOAD_POLL_INTERVAL_MS)
    }

    void poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [state?.status, baseUrl, onKekAdopted])

  async function handleClaimed(primaryPublicKeyBase64: string, sessionId: string) {
    try {
      const { channelKey, code } = await preparePairingChannel(keyPair.privateKey, primaryPublicKeyBase64, sessionId)
      if (!active.current) { channelKey.fill(0); return }
      channelRef.current = { sessionId, channelKey }
      setState({ status: 'awaiting-payload', code })
    } catch {
      setState({ status: 'error', message: msg`Não foi possível concluir o pareamento com segurança. Tente novamente.` })
    }
  }

  if (state?.status === 'awaiting-payload') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p><Trans>Compare o código nos dois dispositivos antes de liberar o acesso.</Trans></p>
        <p className="font-mono text-xl" data-testid="pairing-confirmation">{state.code}</p>
        <p role="status">
          <Trans>Aguardando o outro dispositivo enviar a chave...</Trans>
        </p>
      </div>
    )
  }

  if (state?.status === 'adopted') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Dispositivo pareado com sucesso.</Trans>
        </p>
      </div>
    )
  }

  if (state?.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {i18n._(state.message)}
        </p>
      </div>
    )
  }

  return (
    <PairingScan
      baseUrl={baseUrl}
      decode={decode}
      newDevicePublicKeyBase64={encodeBase64(keyPair.publicKey)}
      onClaimed={(key, sessionId) => { void handleClaimed(key, sessionId) }}
    />
  )
}
