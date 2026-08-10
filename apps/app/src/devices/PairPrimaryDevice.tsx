import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { deriveChannelKey, encrypt, getSharedSecret, generateKeyPair } from '@limmiar/crypto'
import { submitPairingPayload } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { decodeBase64, encodeBase64 } from './base64'
import { PairingQr } from './PairingQr'

export interface PairPrimaryDeviceProps {
  baseUrl: string
  accountId: string
  accessToken: string
  getKekForTransfer: () => Promise<Uint8Array>
  onDelivered?: () => void
}

type DeliveryState =
  | { status: 'waiting-for-claim' }
  | { status: 'delivering' }
  | { status: 'delivered' }
  | { status: 'error'; message: string }

export function PairPrimaryDevice({
  baseUrl,
  accountId,
  accessToken,
  getKekForTransfer,
  onDelivered,
}: PairPrimaryDeviceProps) {
  const { i18n, t } = useLingui()
  const [keyPair] = useState(() => generateKeyPair())
  const [delivery, setDelivery] = useState<DeliveryState>({ status: 'waiting-for-claim' })

  async function handleClaimed(newDevicePublicKeyBase64: string, sessionId: string) {
    setDelivery({ status: 'delivering' })
    try {
      const newDevicePublicKey = decodeBase64(newDevicePublicKeyBase64)
      const sharedSecret = getSharedSecret(keyPair.privateKey, newDevicePublicKey)
      const salt = new TextEncoder().encode(sessionId)
      const channelKey = deriveChannelKey(sharedSecret, salt)

      const kek = await getKekForTransfer()
      const encryptedKek = encrypt(channelKey, kek, salt)
      kek.fill(0)

      const result = await submitPairingPayload(baseUrl, accountId, accessToken, sessionId, encodeBase64(encryptedKek))
      if (!result.ok) {
        setDelivery({ status: 'error', message: translateProblemCode(result.code, result.params, i18n) })
        return
      }

      setDelivery({ status: 'delivered' })
      onDelivered?.()
    } catch {
      setDelivery({
        status: 'error',
        message: t`Não foi possível concluir o pareamento com segurança. Tente novamente.`,
      })
    }
  }

  if (delivery.status === 'delivering') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Enviando a chave para o novo dispositivo...</Trans>
        </p>
      </div>
    )
  }

  if (delivery.status === 'delivered') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Dispositivo pareado com sucesso.</Trans>
        </p>
      </div>
    )
  }

  if (delivery.status === 'error') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {delivery.message}
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
