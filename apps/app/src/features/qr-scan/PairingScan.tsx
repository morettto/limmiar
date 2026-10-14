import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import { claimPairingSession, type PairingQrPayload } from '../../entities/device'
import { decodeFromCamera } from './qr-decode'
import { decodeBase64 } from '../../shared/lib/base64'

export interface PairingScanProps {
  baseUrl: string
  newDevicePublicKeyBase64: string
  decode?: () => Promise<string>
  onClaimed: (primaryPublicKeyBase64: string, sessionId: string) => void
}

type PairingScanState =
  | { status: 'claiming' }
  | { status: 'claimed' }
  | { status: 'error'; message: MessageDescriptor }

function parsePairingQrPayload(text: string): PairingQrPayload | null {
  let parsed: unknown = null
  try { parsed = JSON.parse(text) } catch { /* texto que não é JSON continua null e é recusado abaixo */ }

  if (
    !parsed ||
    typeof (parsed as Record<string, unknown>).s !== 'string' ||
    typeof (parsed as Record<string, unknown>).k !== 'string' ||
    typeof (parsed as Record<string, unknown>).u !== 'string'
  ) {
    return null
  }

  const payload = parsed as PairingQrPayload
  let chaveValida = false
  try { chaveValida = decodeBase64(payload.k).length === 32 } catch { /* base64 inválido: recusado abaixo */ }
  return payload.s && payload.s.length <= 128 && chaveValida ? payload : null
}

// A URL do servidor leva a origem e as credenciais no `href`: igualar o `href` recusa também qualquer usuário ou senha embutidos.
function ehServidorEsperado(baseUrl: string, informado: string): boolean {
  let igual = false
  try { igual = new URL(informado, window.location.origin).href === new URL(baseUrl, window.location.origin).href } catch { /* URL inválida nunca é o servidor esperado */ }
  return igual
}

export function PairingScan({ baseUrl, newDevicePublicKeyBase64, decode, onClaimed }: PairingScanProps) {
  const { i18n, t } = useLingui()
  const [state, setState] = useState<PairingScanState | null>(null)
  const preview = useRef<HTMLVideoElement>(null)

  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function scanAndClaim() {
      let decoded: string
      try {
        decoded = decode ? await decode() : await decodeFromCamera(controller.signal, preview.current!)
      } catch {
        setState({ status: 'error', message: msg`Não foi possível acessar a câmera para escanear o código.` })
        return
      }
      if (cancelled) {
        return
      }

      const payload = parsePairingQrPayload(decoded)
      if (payload === null || !ehServidorEsperado(baseUrl, payload.u)) {
        setState({ status: 'error', message: msg`Código QR inválido. Tente escanear novamente.` })
        return
      }

      setState({ status: 'claiming' })
      const result = await claimPairingSession(baseUrl, payload.s, newDevicePublicKeyBase64)
      if (cancelled) {
        return
      }

      if (!result.ok) {
        setState({ status: 'error', message: problemMessage(result.code, result.params) })
        return
      }

      if (result.primaryPublicKey !== payload.k) {
        setState({ status: 'error', message: msg`A chave recebida não corresponde ao código QR. Gere um novo código no dispositivo de origem.` })
        return
      }

      setState({ status: 'claimed' })
      onClaimed(payload.k, payload.s)
    }

    void scanAndClaim()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])
  // Stryker restore ArrayDeclaration

  if (state?.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {i18n._(state.message)}
        </p>
      </div>
    )
  }

  if (state?.status === 'claimed') {
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
      {!decode && <video ref={preview} playsInline muted aria-label={t`Câmera para escanear o código QR`} className="w-full" />}
      <p role="status">
        {state?.status === 'claiming' ? (
          <Trans>Concluindo o pareamento...</Trans>
        ) : (
          <Trans>Aponte a câmera para o código QR exibido no outro dispositivo.</Trans>
        )}
      </p>
    </div>
  )
}
