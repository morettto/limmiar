import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import { listarSessoes } from '../../entities/agenda/api'
import { horaDaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { ABA_INSIGHTS } from '../../entities/atendimento/atendimento'
import { msg } from '@lingui/core/macro'
import { problemMessage } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'
import { iniciarAtendimento } from './iniciar-atendimento'
import { useProntuario } from './prontuario-context'

export interface HojeDoPacienteProps {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
  /** Agendamento vindo do painel: ganha destaque e o foco. */
  destaque?: string
}

function limitesDeHoje(): [Date, Date] {
  const agora = new Date()
  return [new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()), new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)]
}

export function HojeDoPaciente({ baseUrl, accountId, accessToken, patientId, destaque }: HojeDoPacienteProps) {
  const { i18n, t } = useLingui()
  const { prontuario, recarregar } = useProntuario()
  const navigate = useNavigate()
  const [sessoes, setSessoes] = useState<SessaoAgendada[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<Texto | null>(null)
  const [versao, setVersao] = useState(0)
  const foco = useRef<HTMLElement | null>(null)
  const accessTokenRef = useRef(accessToken)
  accessTokenRef.current = accessToken

  useEffect(() => {
    let ativo = true
    setCarregando(true); setErro(null)
    const [de, ate] = limitesDeHoje()
    void listarSessoes(baseUrl, accountId, accessTokenRef.current, de, ate).then(resultado => {
      if (!ativo) return
      if (!resultado.ok) { setErro(problemMessage(resultado.code, resultado.params)); return }
      setSessoes(resultado.sessoes.filter(sessao => sessao.patientId === patientId))
    }).catch((falha: unknown) => { if (ativo) setErro(falha instanceof Error ? falha.message : msg`Não foi possível carregar a agenda.`) })
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [baseUrl, accountId, patientId, versao])

  useEffect(() => { if (!carregando) foco.current?.focus() }, [carregando, destaque])

  // Stryker disable next-line ArithmeticOperator: equivalent, a version counter only has to differ from the previous value.
  const atualizar = () => setVersao(valor => valor + 1)

  async function iniciar(agendamentoId?: string) {
    setOcupado(true); setErro(null)
    try {
      const atendimento = await iniciarAtendimento({ baseUrl, accountId, accessToken, dek: prontuario.dek, patientId, agendamentoId })
      await recarregar()
      await navigate({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId, atendimentoId: atendimento.id }, search: { aba: ABA_INSIGHTS } })
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : msg`Não foi possível iniciar a sessão.`)
      setOcupado(false)
    }
  }

  return <section className="workspace-card" aria-label={t`Hoje`}>
    <h2><Trans>Hoje</Trans></h2>
    {carregando && <p role="status"><Trans>Carregando agenda de hoje...</Trans></p>}
    {erro !== null && <div><p role="alert">{traduzir(i18n, erro)}</p><button type="button" disabled={ocupado} onClick={atualizar}><Trans>Atualizar agenda</Trans></button></div>}
    {!carregando && erro === null && sessoes.length === 0 && <p><Trans>Nenhum agendamento hoje</Trans></p>}
    <ul>{sessoes.map(sessao => {
      const atendimento = prontuario.atendimentos.find(item => item.agendamentoId === sessao.sessionId)
      const destacado = destaque === sessao.sessionId
      const minutos = sessao.duracaoMinutos
      return <li key={sessao.sessionId} aria-current={destacado ? 'true' : undefined}>
        <time dateTime={sessao.inicioEm}>{horaDaSessao(sessao.inicioEm, i18n.locale)}</time>{' · '}<Trans>{minutos} minutos</Trans>{' '}
        {atendimento
          ? <Link to="/pacientes/$patientId/sessoes/$atendimentoId" params={{ patientId, atendimentoId: atendimento.id }} search={{ aba: ABA_INSIGHTS }}
            ref={destacado ? (elemento) => { foco.current = elemento } : undefined}><Trans>Abrir sessão</Trans></Link>
          : <button type="button" className="button-primary" disabled={ocupado} onClick={() => void iniciar(sessao.sessionId)}
            ref={destacado ? (elemento) => { foco.current = elemento } : undefined}><Trans>Iniciar sessão</Trans></button>}
      </li>
    })}</ul>
    <button type="button" disabled={ocupado} onClick={() => void iniciar()}><Trans>Iniciar sessão agora</Trans></button>
  </section>
}
