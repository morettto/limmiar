import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { claimPairingSession } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { decodeFromCamera } from './qr-decode'

export interface PairingScanProps {
  newDevicePublicKeyBase64: string
  decode?: () => Promise<string>
  onClaimed: (primaryPublicKeyBase64: string, sessionId: string) => void
}

type PairingScanState =
  | { status: 'scanning' }
  | { status: 'claiming' }
  | { status: 'claimed' }
  | { status: 'error'; message: string }

// Matches PairingQr.tsx's JSON.stringify call. Keep the two in sync.
interface PairingQrPayload {
  s: string
  k: string
  u: string
}

function parsePairingQrPayload(text: string): PairingQrPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).s !== 'string' ||
    typeof (parsed as Record<string, unknown>).k !== 'string' ||
    typeof (parsed as Record<string, unknown>).u !== 'string'
  ) {
    return null
  }

  return parsed as PairingQrPayload
}

export function PairingScan({ newDevicePublicKeyBase64, decode = decodeFromCamera, onClaimed }: PairingScanProps) {
  const { i18n, t } = useLingui()
  const [state, setState] = useState<PairingScanState>({ status: 'scanning' })

  useEffect(() => {
    let cancelled = false

    async function scanAndClaim() {
      let decoded: string
      try {
        decoded = await decode()
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: t`Não foi possível acessar a câmera para escanear o código.` })
        }
        return
      }
      if (cancelled) {
        return
      }

      const payload = parsePairingQrPayload(decoded)
      if (payload === null) {
        setState({ status: 'error', message: t`Código QR inválido. Tente escanear novamente.` })
        return
      }

      setState({ status: 'claiming' })
      const result = await claimPairingSession(payload.u, payload.s, newDevicePublicKeyBase64)
      if (cancelled) {
        return
      }

      if (!result.ok) {
        setState({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
        return
      }

      setState({ status: 'claimed' })
      onClaimed(result.primaryPublicKey, payload.s)
    }

    void scanAndClaim()

    return () => {
      cancelled = true
    }
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
      <p role="status">
        {state.status === 'claiming' ? (
          <Trans>Concluindo o pareamento...</Trans>
        ) : (
          <Trans>Aponte a câmera para o código QR exibido no outro dispositivo.</Trans>
        )}
      </p>
    </div>
  )
}
