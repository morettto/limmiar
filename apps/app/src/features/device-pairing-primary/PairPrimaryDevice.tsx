import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { encrypt, generateKeyPair } from '@limmiar/crypto'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import { submitPairingPayload } from '../../entities/device'
import { encodeBase64 } from '../../shared/lib/base64'
import { preparePairingChannel } from '../../entities/device/pairing-channel'
import { PairingQr } from './PairingQr'

export interface PairPrimaryDeviceProps {
  baseUrl: string
  accountId: string
  accessToken: string
  getKekForTransfer: () => Promise<Uint8Array>
  onDelivered?: () => void
}

type DeliveryState =
  | { status: 'confirming'; code: string }
  | { status: 'delivering' }
  | { status: 'delivered' }
  | { status: 'error'; message: MessageDescriptor }

export function PairPrimaryDevice({
  baseUrl,
  accountId,
  accessToken,
  getKekForTransfer,
  onDelivered,
}: PairPrimaryDeviceProps) {
  const { i18n } = useLingui()
  const [keyPair] = useState(() => generateKeyPair())
  const [delivery, setDelivery] = useState<DeliveryState | null>(null)
  const channelRef = useRef<{ sessionId: string; channelKey: Uint8Array } | null>(null)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const active = useRef(true)
  const sending = useRef(false)
  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    active.current = true
    return () => { active.current = false; channelRef.current?.channelKey.fill(0); channelRef.current = null }
  }, [])
  // Stryker restore ArrayDeclaration

  async function handleClaimed(newDevicePublicKeyBase64: string, sessionId: string) {
    try {
      const { channelKey, code } = await preparePairingChannel(keyPair.privateKey, newDevicePublicKeyBase64, sessionId)
      if (!active.current) { channelKey.fill(0); return }
      channelRef.current = { sessionId, channelKey }
      setDelivery({ status: 'confirming', code })
    } catch {
      setDelivery({ status: 'error', message: msg`Não foi possível concluir o pareamento com segurança. Tente novamente.` })
    }
  }

  async function confirmDelivery() {
    if (sending.current || channelRef.current === null) return
    sending.current = true
    const { sessionId, channelKey } = channelRef.current
    setDelivery({ status: 'delivering' })
    try {
      const salt = new TextEncoder().encode(sessionId)
      const kek = await getKekForTransfer()
      let encryptedKek: Uint8Array
      try {
        if (!active.current) return
        if (kek.length !== 32) throw new RangeError()
        encryptedKek = encrypt(channelKey, kek, salt)
      } finally { kek.fill(0) }

      const result = await submitPairingPayload(baseUrl, accountId, accessToken, sessionId, encodeBase64(encryptedKek))
      if (!active.current) return
      if (!result.ok) {
        setDelivery({ status: 'error', message: problemMessage(result.code, result.params) })
        return
      }

      setDelivery({ status: 'delivered' })
      onDelivered?.()
    } catch {
      setDelivery({
        status: 'error',
        message: msg`Não foi possível concluir o pareamento com segurança. Tente novamente.`,
      })
    } finally { channelKey.fill(0); channelRef.current = null }
  }

  if (delivery?.status === 'confirming') {
    return <section className="editorial-card">
      <h2><Trans>Confirme o novo dispositivo</Trans></h2>
      <p><Trans>Compare este código com o exibido no outro dispositivo. Continue somente se forem iguais.</Trans></p>
      <p className="font-mono text-xl" data-testid="pairing-confirmation">{delivery.code}</p>
      <button type="button" onClick={() => void confirmDelivery()}><Trans>Os códigos são iguais. Liberar acesso.</Trans></button>
      <button type="button" onClick={() => {
        channelRef.current!.channelKey.fill(0); channelRef.current = null
        setDelivery({ status: 'error', message: msg`Pareamento cancelado. Nenhuma chave foi enviada.` })
      }}><Trans>Cancelar pareamento</Trans></button>
    </section>
  }

  if (delivery?.status === 'delivering') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Enviando a chave para o novo dispositivo...</Trans>
        </p>
      </div>
    )
  }

  if (delivery?.status === 'delivered') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Dispositivo pareado com sucesso.</Trans>
        </p>
      </div>
    )
  }

  if (delivery?.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {i18n._(delivery.message)}
        </p>
      </div>
    )
  }

  return (
    <PairingQr
      baseUrl={baseUrl}
      accountId={accountId}
      accessToken={accessToken}
      primaryPublicKeyBase64={encodeBase64(keyPair.publicKey)}
      onClaimed={(newDevicePublicKeyBase64, sessionId) => {
        void handleClaimed(newDevicePublicKeyBase64, sessionId)
      }}
    />
  )
}
