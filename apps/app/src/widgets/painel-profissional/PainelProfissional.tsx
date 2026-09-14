import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AdaptivePanel, KpiStrip } from '@limmiar/ui'
import type { CryptoKey } from '@limmiar/crypto'
import { listarSessoes } from '../../entities/agenda/api'
import { contarPorComecar, horaDaSessao, proximaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { obterConsentimentos } from '../../entities/consentimento/api'
import type { Nota } from '../../entities/nota/nota'
import { listPatients } from '../../entities/patient/api'
import type { SealedSummary, SummaryResult } from '../../entities/patient/patient-summary'
import { openSummariesInWorker } from '../../entities/patient/worker-client'
import { translateProblemCode, type ProblemResult } from '../../shared/api'
import { itensDeAssinatura, itensDeConsentimento, itensDeRisco, juntarRequerVoce, type ConsentimentosPorPaciente } from './requer-voce'

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

// Uma fonte falha por `ProblemResult` (código de negócio, traduzível) ou `null` (exceção
// lançada -- sem código nenhum do backend). Cru aqui, só o render traduz -- ver README.
type FalhaFonte = ProblemResult | null

type ResultadoFonte<T> = { ok: true; dados: T } | { ok: false; falha: FalhaFonte }

type DadosPacientes = { sumarios: readonly SummaryResult[]; consentimentos: readonly ConsentimentosPorPaciente[] }

type Chaveiro = { kek: CryptoKey; accountId: string; accessToken: string }

export interface PainelProfissionalProps {
  baseUrl: string
  /** null = the keychain is locked; the panel shows no names and makes no request. */
  chaveiro: Chaveiro | null
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

export function PainelProfissional({ baseUrl, chaveiro, notas, openSummaries = openSummariesInWorker }: PainelProfissionalProps) {
  const { i18n, t } = useLingui()
  const [estado, setEstado] = useState<EstadoPainel>({ status: 'a-carregar' })

  // Sempre a última prop, sem entrar nas deps do efeito -- é assim que uma renovação de
  // accessToken em voo (kek/accountId iguais) chega ao próximo pedido sem recarregar o
  // painel nem redecifrar (ver README, "accessToken via ref").
  const chaveiroRef = useRef(chaveiro)
  chaveiroRef.current = chaveiro

  useEffect(() => {
    if (chaveiro === null) {
      return
    }
    const { kek: unlockedKek, accountId: accId, accessToken: tokenAoEntrar } = chaveiro

    let cancelled = false
    const abortController = new AbortController()

    function tokenAtual(): string {
      return chaveiroRef.current?.accessToken ?? tokenAoEntrar
    }

    async function carregarPacientes(): Promise<ResultadoFonte<DadosPacientes>> {
      const listados = await listPatients(baseUrl, accId, tokenAtual())
      if (!listados.ok) {
        return { ok: false, falha: listados }
      }

      // ponytail: `signal` só chega até aqui, não a `listPatients`/`obterConsentimentos` -- ver README.
      const decifrados = await openSummaries(unlockedKek, listados.patients, abortController.signal)

      // ponytail: `obterConsentimentos` por paciente (fan-out N+1) -- endpoint em lote é o
      // upgrade quando isso virar gargalo. Uma rejeição genuína (rede) e um `ProblemResult`
      // (`{ok:false}`) caem ambos fora da lista -- nenhum dos dois é exceção de domínio.
      const resultados = await Promise.all(
        decifrados.map(async (resumo): Promise<ConsentimentosPorPaciente[]> => {
          const resultado = await obterConsentimentos(baseUrl, accId, tokenAtual(), resumo.patientId).catch(() => null)
          return resultado?.ok ? [{ patientId: resumo.patientId, consentimentos: resultado.consentimentos }] : []
        }),
      )

      return { ok: true, dados: { sumarios: decifrados, consentimentos: resultados.flat() } }
    }

    async function carregarSessoes(): Promise<ResultadoFonte<readonly SessaoAgendada[]>> {
      const agora = new Date()
      const resultado = await listarSessoes(baseUrl, accId, tokenAtual(), agora, new Date(agora.getTime() + SETE_DIAS_MS))
      if (!resultado.ok) {
        return { ok: false, falha: resultado }
      }
      return { ok: true, dados: resultado.sessoes }
    }

    async function carregar() {
      // As duas fontes nunca rejeitam para o `Promise.all` -- cada uma tem o seu próprio
      // `.catch`, senão uma falha de rede na agenda derrubaria também os pacientes (e vice-versa).
      const [pacientes, sessoes] = await Promise.all([
        carregarPacientes().catch((): ResultadoFonte<DadosPacientes> => ({ ok: false, falha: null })),
        carregarSessoes().catch((): ResultadoFonte<readonly SessaoAgendada[]> => ({ ok: false, falha: null })),
      ])
      if (cancelled) return

      setEstado({ status: 'pronto', pacientes, sessoes })
    }

    // Sem `.catch()` aqui (ao contrário de `PatientWallet`): `carregar` em si não rejeita --
    // as duas fontes já absorvem a própria falha acima -- um `.catch` só ficaria morto.
    void carregar()

    return () => {
      cancelled = true
      abortController.abort()
      // Repõe "a-carregar" para a próxima conta nunca herdar os dados desta -- ver README.
      setEstado({ status: 'a-carregar' })
    }
    // `i18n`/`t` de propósito fora daqui -- eles só traduzem no render (ver `traduzirFalha*`
    // abaixo); `chaveiro.accessToken` também fica fora -- lido via ref em `tokenAtual` (ver
    // README).
  }, [chaveiro?.kek, chaveiro?.accountId, baseUrl, openSummaries])

  if (chaveiro === null) {
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

  function traduzirFalha(falha: FalhaFonte, mensagemRede: string): string {
    return falha === null ? mensagemRede : translateProblemCode(falha.code, falha.params, i18n)
  }

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
          {traduzirFalha(pacientes.falha, t`Não foi possível carregar o painel. Tente novamente.`)}
        </p>
      )}
      {!sessoes.ok && (
        <p role="alert" className="text-sm text-red-700">
          {traduzirFalha(sessoes.falha, t`Não foi possível carregar a agenda.`)}
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
