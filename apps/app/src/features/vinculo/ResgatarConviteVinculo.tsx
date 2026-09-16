import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { translateProblemCode } from '../../shared/api'
import { resgatarConviteVinculo, type Vinculo } from '../../entities/vinculo/api'
import { garantirParDeChaves } from '../../entities/vinculo/par-de-chaves'

export interface ResgatarConviteVinculoProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  onVinculada?: (vinculo: Vinculo) => void
}

type ResgateState =
  | { status: 'idle' }
  | { status: 'resgatando' }
  | { status: 'vinculada' }
  | { status: 'erro'; mensagem: string }

export function ResgatarConviteVinculo({
  baseUrl,
  accountId,
  accessToken,
  kek,
  onVinculada,
}: ResgatarConviteVinculoProps) {
  const { i18n } = useLingui()
  const [codigo, setCodigo] = useState('')
  const [resgate, setResgate] = useState<ResgateState>({ status: 'idle' })

  // Mesma decisão do GerarConviteVinculo: garante a pública publicada ao abrir o ecrã, sem
  // bloquear o resgate se isto falhar.
  useEffect(() => {
    garantirParDeChaves({ baseUrl, accountId, accessToken, kek }).catch((erro: unknown) => {
      console.error('ResgatarConviteVinculo: falha ao garantir o par de chaves', erro)
    })
  }, [baseUrl, accountId, accessToken, kek])

  async function handleVincular() {
    setResgate({ status: 'resgatando' })
    const result = await resgatarConviteVinculo(baseUrl, accountId, accessToken, codigo)
    if (result.ok) {
      setResgate({ status: 'vinculada' })
      onVinculada?.(result.vinculo)
      return
    }
    setResgate({ status: 'erro', mensagem: translateProblemCode(result.code, result.params, i18n) })
  }

  if (resgate.status === 'vinculada') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Vinculada.</Trans>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium">
          <Trans>Código de vínculo</Trans>
        </span>
        <input
          type="text"
          value={codigo}
          onChange={(event) => setCodigo(event.target.value)}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
        />
      </label>

      {resgate.status === 'erro' ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {resgate.mensagem}
        </p>
      ) : null}

      <button
        type="button"
        disabled={resgate.status === 'resgatando'}
        onClick={() => void handleVincular()}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white"
      >
        <Trans>Vincular</Trans>
      </button>
    </div>
  )
}
