import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AdaptivePanel, KpiStrip } from '@limmiar/ui'
import type { CryptoKey } from '@limmiar/crypto'
import { listarSessoesDaSemana } from '../../entities/agenda/api'
import { contarPorComecar, horaDaSessao, proximaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { obterConsentimentos } from '../../entities/consentimento/api'
import type { Nota } from '../../entities/nota/nota'
import { listPatients } from '../../entities/patient/api'
import type { SealedSummary, SummaryResult } from '../../entities/patient/patient-summary'
import { openSummariesInWorker } from '../../entities/patient/worker-client'
import { translateProblemCode } from '../../shared/api'
import { itensDeAssinatura, itensDeConsentimento, itensDeRisco, juntarRequerVoce, type ConsentimentosPorPaciente } from './requer-voce'

type ResultadoFonte<T> = { ok: true; dados: T } | { ok: false; motivo: string }

type DadosPacientes = { sumarios: readonly SummaryResult[]; consentimentos: readonly ConsentimentosPorPaciente[] }

export interface PainelProfissionalProps {
  baseUrl: string
  accountId: string | null
  accessToken: string | null
  /** null = the keychain is locked; the panel shows no names and makes no request. */
  kek: CryptoKey | null
  notas: readonly Nota[]
  /** Test seam; defaults to the real Web Worker decrypt path. */
  openSummaries?: (kek: CryptoKey, items: SealedSummary[], signal?: AbortSignal) => Promise<SummaryResult[]>
}

type EstadoPainel =
  | { status: 'a-carregar' }
  | {
      status: 'pronto'
      pacientes: ResultadoFonte<DadosPacientes>
      sessoes: ResultadoFonte<readonly SessaoAgendada[]>
    }

// Fonte única da guarda: o render decide "bloqueado" a partir das props, o efeito usa a
// mesma função para decidir se busca. tsc -b (build) exige que a guarda estreite os três
// valores -- um boolean compilava no tsc --noEmit e caía no build.
type Chaveiro = { kek: CryptoKey | null; accountId: string | null; accessToken: string | null }
type ChaveiroDestrancado = { kek: CryptoKey; accountId: string; accessToken: string }

function chaveiroDestrancado(chaveiro: Chaveiro): chaveiro is ChaveiroDestrancado {
  return chaveiro.kek !== null && chaveiro.accountId !== null && chaveiro.accessToken !== null
}

export function PainelProfissional({
  baseUrl,
  accountId,
  accessToken,
  kek,
  notas,
  openSummaries = openSummariesInWorker,
}: PainelProfissionalProps) {
  const { i18n, t } = useLingui()
  const [estado, setEstado] = useState<EstadoPainel>({ status: 'a-carregar' })

  useEffect(() => {
    const chaveiro = { kek, accountId, accessToken }
    if (!chaveiroDestrancado(chaveiro)) {
      return
    }

    let cancelled = false
    const abortController = new AbortController()

    async function carregarPacientes(unlockedKek: CryptoKey, accId: string, token: string): Promise<ResultadoFonte<DadosPacientes>> {
      const listados = await listPatients(baseUrl, accId, token)
      if (!listados.ok) {
        return { ok: false, motivo: translateProblemCode(listados.code, listados.params, i18n) }
      }

      // `cancelled` verificado no ponto de consumo, não lançado -- ver README, "cancelamento".
      // ponytail: `signal` só chega até aqui, não a `listPatients`/`obterConsentimentos` -- ver README.
      const decifrados = cancelled ? [] : await openSummaries(unlockedKek, listados.patients, abortController.signal)

      // ponytail: `obterConsentimentos` por paciente (fan-out N+1) -- endpoint em lote é o
      // upgrade quando isso virar gargalo. Uma rejeição genuína (rede) e um `ProblemResult`
      // (`{ok:false}`) caem ambos fora da lista -- nenhum dos dois é exceção de domínio.
      const resultados = await Promise.all(
        decifrados.map(async (resumo): Promise<ConsentimentosPorPaciente[]> => {
          const resultado = await obterConsentimentos(baseUrl, accId, token, resumo.patientId).catch(() => null)
          return resultado?.ok ? [{ patientId: resumo.patientId, consentimentos: resultado.consentimentos }] : []
        }),
      )

      return { ok: true, dados: { sumarios: decifrados, consentimentos: resultados.flat() } }
    }

    async function carregarSessoes(accId: string, token: string): Promise<ResultadoFonte<readonly SessaoAgendada[]>> {
      const resultado = await listarSessoesDaSemana(baseUrl, accId, token, new Date())
      if (!resultado.ok) {
        return { ok: false, motivo: translateProblemCode(resultado.code, resultado.params, i18n) }
      }
      return { ok: true, dados: resultado.sessoes }
    }

    async function carregar(unlockedKek: CryptoKey, accId: string, token: string) {
      // As duas fontes nunca rejeitam para o `Promise.all` -- cada uma tem o seu próprio
      // `.catch`, senão uma falha de rede na agenda derrubaria também os pacientes (e vice-versa).
      const [pacientes, sessoes] = await Promise.all([
        carregarPacientes(unlockedKek, accId, token).catch(
          (): ResultadoFonte<DadosPacientes> => ({ ok: false, motivo: t`Não foi possível carregar o painel. Tente novamente.` }),
        ),
        carregarSessoes(accId, token).catch(
          (): ResultadoFonte<readonly SessaoAgendada[]> => ({
            ok: false,
            motivo: t`Não foi possível carregar a agenda.`,
          }),
        ),
      ])
      if (cancelled) return

      setEstado({ status: 'pronto', pacientes, sessoes })
    }

    // Sem `.catch()` aqui (ao contrário de `PatientWallet`): `carregar` em si não rejeita --
    // as duas fontes já absorvem a própria falha acima -- um `.catch` só ficaria morto.
    void carregar(chaveiro.kek, chaveiro.accountId, chaveiro.accessToken)

    return () => {
      cancelled = true
      abortController.abort()
      // Repõe "a-carregar" para a próxima conta nunca herdar os dados desta -- ver README.
      setEstado({ status: 'a-carregar' })
    }
  }, [kek, accountId, accessToken, baseUrl, openSummaries, i18n, t])

  if (!chaveiroDestrancado({ kek, accountId, accessToken })) {
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

  const { pacientes, sessoes } = estado

  function nomeDoPaciente(patientId: string): string | null {
    if (!pacientes.ok) {
      return null
    }
    const resumo = pacientes.dados.sumarios.find((item) => item.patientId === patientId)
    return resumo !== undefined && resumo.ok ? resumo.name : null
  }

  const agora = new Date()
  const proxima = sessoes.ok ? proximaSessao(sessoes.dados, agora) : null

  function rotuloAcaoPrincipal(): string {
    if (proxima === null) {
      return t`Iniciar próxima sessão`
    }
    const hora = horaDaSessao(proxima.inicioEm, i18n.locale)
    const nome = nomeDoPaciente(proxima.patientId)
    return nome === null ? t`Iniciar próxima sessão às ${hora}` : t`Iniciar próxima: ${nome} ${hora}`
  }

  const itens = juntarRequerVoce([
    pacientes.ok ? itensDeRisco(pacientes.dados.sumarios) : [],
    itensDeAssinatura(notas),
    pacientes.ok ? itensDeConsentimento(pacientes.dados.consentimentos) : [],
  ])

  return (
    <div className="mx-auto max-w-3xl p-4">
      <button type="button">▶ {rotuloAcaoPrincipal()}</button>
      <KpiStrip aria-label={t`Indicadores`}>
        <KpiStrip.Item
          label={t`Pacientes ativos`}
          value={pacientes.ok ? pacientes.dados.sumarios.filter((item) => item.ok).length : '—'}
        />
        <KpiStrip.Item
          label={t`Sessões na semana`}
          value={sessoes.ok ? contarPorComecar(sessoes.dados, agora) : '—'}
        />
      </KpiStrip>
      {!pacientes.ok && (
        <p role="alert" className="text-sm text-red-700">
          {pacientes.motivo}
        </p>
      )}
      {!sessoes.ok && (
        <p role="alert" className="text-sm text-red-700">
          {sessoes.motivo}
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
