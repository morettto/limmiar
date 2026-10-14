import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import type { MessageDescriptor } from '@lingui/core'
import { problemMessage } from '../../shared/api'
import { criarConviteVinculo } from '../../entities/vinculo/api'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'

export interface GerarConviteVinculoProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  patientId: string
}

type ConviteState =
  | { status: 'gerando' }
  | { status: 'gerado'; codigo: string; expiraEm: string }
  | { status: 'erro'; mensagem: MessageDescriptor }

export function GerarConviteVinculo({ baseUrl, accountId, accessToken, kek, patientId }: GerarConviteVinculoProps) {
  const { i18n, t } = useLingui()
  const [convite, setConvite] = useState<ConviteState | null>(null)

  // A falha aqui não bloqueia gerar o convite (que não depende dela) -- só fica registada para
  // diagnóstico.
  useEffect(() => {
    garantirParDeChaves({ baseUrl, accountId, accessToken, kek }).catch((erro: unknown) => {
      console.error('GerarConviteVinculo: falha ao garantir o par de chaves', erro)
    })
  }, [baseUrl, accountId, accessToken, kek])

  async function handleGerar() {
    setConvite({ status: 'gerando' })
    const result = await criarConviteVinculo(baseUrl, accountId, accessToken, patientId)
    if (result.ok) {
      setConvite({ status: 'gerado', codigo: result.codigo, expiraEm: result.expiraEm })
    } else {
      setConvite({ status: 'erro', mensagem: problemMessage(result.code, result.params) })
    }
  }

  if (convite?.status === 'gerado') {
    const { codigo } = convite
    const validade = new Date(convite.expiraEm).toLocaleString(i18n.locale)
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">{t`Código de vínculo: ${codigo}. Válido até ${validade}.`}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      {convite?.status === 'erro' ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {i18n._(convite.mensagem)}
        </p>
      ) : null}
      <button
        type="button"
        disabled={convite?.status === 'gerando'}
        onClick={() => void handleGerar()}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white"
      >
        <Trans>Gerar código de vínculo</Trans>
      </button>
    </div>
  )
}
