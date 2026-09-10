import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AdaptivePanel, KpiStrip } from '@limmiar/ui'
import type { CryptoKey } from '@limmiar/crypto'
import { horaDaSessao, proximaSessao, sessoesNaSemana, type SessaoAgendada } from '../../entities/agenda/sessao'
import { obterConsentimentos, type ConsentimentosDoPaciente } from '../../entities/consentimento/api'
import type { Nota } from '../../entities/nota/nota'
import { listPatients } from '../../entities/patient/api'
import type { SealedSummary, SummaryResult } from '../../entities/patient/patient-summary'
import { openSummariesInWorker } from '../../entities/patient/worker-client'
import { translateProblemCode } from '../../shared/api'
import { itensDeAssinatura, itensDeConsentimento, itensDeRisco, juntarRequerVoce, type ResultadoFonte } from './requer-voce'

type ConsentimentosPorPaciente = { patientId: string; consentimentos: ConsentimentosDoPaciente }

export interface PainelProfissionalProps {
  baseUrl: string
  accountId: string | null
  accessToken: string | null
  /** null = the keychain is locked; the panel shows no names and makes no request. */
  kek: CryptoKey | null
  notas: readonly Nota[]
  sessoes: readonly SessaoAgendada[]
  /** Test seam; defaults to the real Web Worker decrypt path. */
  openSummaries?: (kek: CryptoKey, items: SealedSummary[], signal?: AbortSignal) => Promise<SummaryResult[]>
}

type EstadoPainel =
  | { status: 'bloqueado' }
  | { status: 'a-carregar' }
  | {
      status: 'pronto'
      pacientes: ResultadoFonte<readonly SummaryResult[]>
      consentimentos: ResultadoFonte<readonly ConsentimentosPorPaciente[]>
    }

// Fonte única da guarda (`estadoInicial` e `useEffect`) -- ver README, "guarda unificada".
// Type predicate: o `tsc -b` do `build` recusa `kek` a chegar a `carregar` como `CryptoKey | null`.
type Chaveiro = { kek: CryptoKey | null; accountId: string | null; accessToken: string | null }
type ChaveiroDestrancado = { kek: CryptoKey; accountId: string; accessToken: string }

function chaveiroDestrancado(chaveiro: Chaveiro): chaveiro is ChaveiroDestrancado {
  return chaveiro.kek !== null && chaveiro.accountId !== null && chaveiro.accessToken !== null
}

export function estadoInicial(
  kek: CryptoKey | null,
  accountId: string | null,
  accessToken: string | null,
): EstadoPainel {
  return chaveiroDestrancado({ kek, accountId, accessToken }) ? { status: 'a-carregar' } : { status: 'bloqueado' }
}

export function PainelProfissional({
  baseUrl,
  accountId,
  accessToken,
  kek,
  notas,
  sessoes,
  openSummaries = openSummariesInWorker,
}: PainelProfissionalProps) {
  const { i18n, t } = useLingui()
  const [estado, setEstado] = useState<EstadoPainel>(() => estadoInicial(kek, accountId, accessToken))

  useEffect(() => {
    const chaveiro = { kek, accountId, accessToken }
    if (!chaveiroDestrancado(chaveiro)) {
      setEstado({ status: 'bloqueado' })
      return
    }

    let cancelled = false
    const abortController = new AbortController()
    setEstado({ status: 'a-carregar' })

    async function carregar(unlockedKek: CryptoKey, accId: string, token: string) {
      const listados = await listPatients(baseUrl, accId, token)
      if (cancelled) return

      if (!listados.ok) {
        const motivo = translateProblemCode(listados.code, listados.params, i18n)
        setEstado({ status: 'pronto', pacientes: { ok: false, motivo }, consentimentos: { ok: false, motivo } })
        return
      }

      const decifrados = await openSummaries(unlockedKek, listados.patients, abortController.signal)
      if (cancelled) return

      // ponytail: `obterConsentimentos` por paciente (fan-out N+1) -- endpoint em lote é o
      // upgrade quando isso virar gargalo. `allSettled` apanha a rejeição genuína (rede);
      // `ProblemResult` vira `{ok:false}` resolvido e filtrado abaixo, não um `throw`.
      const resultados = await Promise.allSettled(
        decifrados.map(async (resumo): Promise<{ ok: true; item: ConsentimentosPorPaciente } | { ok: false }> => {
          const resultado = await obterConsentimentos(baseUrl, accId, token, resumo.patientId)
          if (!resultado.ok) {
            return { ok: false }
          }
          return { ok: true, item: { patientId: resumo.patientId, consentimentos: resultado.consentimentos } }
        }),
      )
      if (cancelled) return

      const consentimentosOk = resultados
        .filter(
          (resultado): resultado is PromiseFulfilledResult<{ ok: true; item: ConsentimentosPorPaciente }> =>
            resultado.status === 'fulfilled' && resultado.value.ok,
        )
        .map((resultado) => resultado.value.item)

      setEstado({
        status: 'pronto',
        pacientes: { ok: true, dados: decifrados },
        consentimentos: { ok: true, dados: consentimentosOk },
      })
    }

    carregar(chaveiro.kek, chaveiro.accountId, chaveiro.accessToken).catch(() => {
      if (!cancelled) {
        const motivo = t`Não foi possível carregar o painel. Tente novamente.`
        setEstado({ status: 'pronto', pacientes: { ok: false, motivo }, consentimentos: { ok: false, motivo } })
      }
    })

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [kek, accountId, accessToken, baseUrl, openSummaries, i18n, t])

  if (estado.status === 'bloqueado') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Chaveiro bloqueado. Desbloqueie para ver o painel.</Trans>
        </p>
      </div>
    )
  }

  if (estado.status === 'a-carregar') {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Carregando painel...</Trans>
        </p>
      </div>
    )
  }

  const { pacientes, consentimentos } = estado

  function nomeDoPaciente(patientId: string): string | null {
    if (!pacientes.ok) {
      return null
    }
    const resumo = pacientes.dados.find((item) => item.patientId === patientId)
    return resumo !== undefined && resumo.ok ? resumo.name : null
  }

  const agora = new Date()
  const proxima = proximaSessao(sessoes, agora)

  function rotuloAcaoPrincipal(): string {
    if (proxima === null) {
      return t`Iniciar próxima sessão`
    }
    const hora = horaDaSessao(proxima.inicioEm, i18n.locale)
    const nome = nomeDoPaciente(proxima.patientId)
    return nome === null ? t`Iniciar próxima sessão às ${hora}` : t`Iniciar próxima: ${nome} ${hora}`
  }

  const fonteRisco = pacientes.ok
    ? { ok: true as const, dados: itensDeRisco(pacientes.dados) }
    : { ok: false as const, motivo: pacientes.motivo }
  const fonteConsentimento = consentimentos.ok
    ? { ok: true as const, dados: itensDeConsentimento(consentimentos.dados) }
    : { ok: false as const, motivo: consentimentos.motivo }
  const itens = juntarRequerVoce([fonteRisco, { ok: true, dados: itensDeAssinatura(notas) }, fonteConsentimento])

  return (
    <div className="mx-auto max-w-3xl p-4">
      <button type="button">▶ {rotuloAcaoPrincipal()}</button>
      <KpiStrip aria-label={t`Indicadores`}>
        <KpiStrip.Item
          label={t`Pacientes ativos`}
          value={pacientes.ok ? pacientes.dados.filter((item) => item.ok).length : '—'}
        />
        <KpiStrip.Item label={t`Sessões na semana`} value={sessoesNaSemana(sessoes, agora)} />
      </KpiStrip>
      {!pacientes.ok && (
        <p role="alert" className="text-sm text-red-700">
          {pacientes.motivo}
        </p>
      )}
      <AdaptivePanel label={t`Requer você`}>
        <ul aria-label={t`Requer você`}>
          {itens.map((item) => (
            <li key={item.id}>{nomeDoPaciente(item.patientId) ?? t`Paciente`}</li>
          ))}
        </ul>
      </AdaptivePanel>
    </div>
  )
}
