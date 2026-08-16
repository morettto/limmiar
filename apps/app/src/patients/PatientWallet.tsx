import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AdaptiveTable } from '@limmiar/ui'
import type { CryptoKey } from '@limmiar/crypto'
import { listPatients } from '../api/client'
import { translateProblemCode } from '../errors/problem-messages'
import { sortByRisk, type PatientRisk, type SealedSummary, type SummaryResult } from './patient-summary'
import { openSummariesInWorker } from './worker-client'

export interface PatientWalletProps {
  baseUrl: string
  accountId: string
  accessToken: string
  /** null = the keychain is locked; the wallet shows no names and makes no request. */
  kek: CryptoKey | null
  /** Test seam; defaults to the real Web Worker decrypt path. */
  openSummaries?: (kek: CryptoKey, items: SealedSummary[], signal?: AbortSignal) => Promise<SummaryResult[]>
}

type WalletState =
  | { status: 'locked' }
  | { status: 'loading' }
  | { status: 'ready'; results: SummaryResult[] }
  | { status: 'error'; message: string }

function riskLabel(risk: PatientRisk): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1)
}

export function PatientWallet({
  baseUrl,
  accountId,
  accessToken,
  kek,
  openSummaries = openSummariesInWorker,
}: PatientWalletProps) {
  const { i18n, t } = useLingui()
  const [state, setState] = useState<WalletState>(kek === null ? { status: 'locked' } : { status: 'loading' })

  useEffect(() => {
    if (kek === null) {
      setState({ status: 'locked' })
      return
    }

    let cancelled = false
    const abortController = new AbortController()
    setState({ status: 'loading' })

    async function load(unlockedKek: CryptoKey) {
      const listed = await listPatients(baseUrl, accountId, accessToken)
      if (cancelled) return

      if (!listed.ok) {
        setState({ status: 'error', message: translateProblemCode(listed.code, listed.params, i18n) })
        return
      }

      const decrypted = await openSummaries(unlockedKek, listed.patients, abortController.signal)
      if (cancelled) return
      setState({ status: 'ready', results: sortByRisk(decrypted) })
    }

    load(kek).catch(() => {
      if (!cancelled) {
        setState({
          status: 'error',
          message: t`Não foi possível carregar a carteira de pacientes. Tente novamente.`,
        })
      }
    })

    return () => {
      cancelled = true
      // Frees the Worker (and stops it burning CPU on an in-flight batch) as soon as the
      // wallet unmounts instead of letting it decrypt to completion into a result nobody reads.
      abortController.abort()
    }
  }, [kek, baseUrl, accountId, accessToken, openSummaries, i18n, t])

  if (state.status === 'locked') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Chaveiro bloqueado. Desbloqueie para ver a carteira de pacientes.</Trans>
        </p>
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Carregando pacientes...</Trans>
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

  const rows = state.results.map((result) => ({
    key: result.patientId,
    cells: result.ok ? [result.name, riskLabel(result.risk)] : [t`Não foi possível ler`, ''],
  }))

  return (
    <AdaptiveTable
      caption={t`Pacientes`}
      columns={[
        { key: 'name', header: t`Paciente` },
        { key: 'risk', header: t`Risco` },
      ]}
      rows={rows}
    />
  )
}
