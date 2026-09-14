import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { translateProblemCode } from '../../shared/api'
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
  | { status: 'idle' }
  | { status: 'gerando' }
  | { status: 'gerado'; codigo: string; validade: string }
  | { status: 'erro'; mensagem: string }

export function GerarConviteVinculo({ baseUrl, accountId, accessToken, kek, patientId }: GerarConviteVinculoProps) {
  const { i18n, t } = useLingui()
  const [convite, setConvite] = useState<ConviteState>({ status: 'idle' })

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
      const validade = new Date(result.expiraEm).toLocaleString(i18n.locale)
      setConvite({ status: 'gerado', codigo: result.codigo, validade })
    } else {
      setConvite({ status: 'erro', mensagem: translateProblemCode(result.code, result.params, i18n) })
    }
  }

  if (convite.status === 'gerado') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">{t`Código de vínculo: ${convite.codigo}. Válido até ${convite.validade}.`}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      {convite.status === 'erro' ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {convite.mensagem}
        </p>
      ) : null}
      <button
        type="button"
        disabled={convite.status === 'gerando'}
        onClick={() => void handleGerar()}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white"
      >
        <Trans>Gerar código de vínculo</Trans>
      </button>
    </div>
  )
}
