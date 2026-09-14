import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { translateProblemCode } from '../../shared/api'
import { desvincular, listarVinculos, type Vinculo } from '../../entities/vinculo/api'

export interface DesvincularVinculoProps {
  baseUrl: string
  accountId: string
  accessToken: string
}

type ListaState =
  | { status: 'carregando' }
  | { status: 'pronta'; vinculos: Vinculo[] }
  | { status: 'erro'; mensagem: string }

// Vale para as duas pontas: o outro lado do vínculo é o que não é `accountId`.
function outraContaDoVinculo(vinculo: Vinculo, accountId: string): string {
  return vinculo.profissionalAccountId === accountId ? vinculo.pacienteAccountId : vinculo.profissionalAccountId
}

export function DesvincularVinculo({ baseUrl, accountId, accessToken }: DesvincularVinculoProps) {
  const { i18n, t } = useLingui()
  const [estado, setEstado] = useState<ListaState>({ status: 'carregando' })
  const [erroPorConta, setErroPorConta] = useState<Record<string, string>>({})

  async function carregar() {
    const result = await listarVinculos(baseUrl, accountId, accessToken)
    if (result.ok) {
      setEstado({ status: 'pronta', vinculos: result.vinculos })
    } else {
      setEstado({ status: 'erro', mensagem: translateProblemCode(result.code, result.params, i18n) })
    }
  }

  useEffect(() => {
    void carregar()
  }, [baseUrl, accountId, accessToken])

  async function handleDesvincular(outraContaId: string) {
    const result = await desvincular(baseUrl, accountId, accessToken, outraContaId)
    if (result.ok) {
      await carregar()
      return
    }
    setErroPorConta((atual) => ({ ...atual, [outraContaId]: translateProblemCode(result.code, result.params, i18n) }))
  }

  if (estado.status === 'carregando') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Carregando vínculos...</Trans>
        </p>
      </div>
    )
  }

  if (estado.status === 'erro') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {estado.mensagem}
        </p>
      </div>
    )
  }

  if (estado.vinculos.length === 0) {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Nenhum vínculo.</Trans>
        </p>
      </div>
    )
  }

  return (
    <ul className="mx-auto max-w-sm p-4">
      {estado.vinculos.map((vinculo) => {
        const outraContaId = outraContaDoVinculo(vinculo, accountId)
        const mensagemErro = erroPorConta[outraContaId]
        return (
          <li key={outraContaId} className="mb-3">
            <div className="flex items-center justify-between gap-2">
              <span>{vinculo.patientId}</span>
              <button
                type="button"
                onClick={() => void handleDesvincular(outraContaId)}
                aria-label={t`Desvincular vínculo com ${vinculo.patientId}`}
                className="rounded-md bg-neutral-900 px-3 py-1 text-white"
              >
                <Trans>Desvincular</Trans>
              </button>
            </div>
            {mensagemErro !== undefined ? (
              <p role="alert" className="text-sm text-red-700">
                {mensagemErro}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
