import { Link } from '@tanstack/react-router'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { ABA_INSIGHTS, FORMATO_DATA_ATENDIMENTO } from '../../entities/atendimento/atendimento'
import { EstadoDoAtendimento } from '../../features/prontuario/EstadoDoAtendimento'
import { useProntuario } from '../../features/prontuario/prontuario-context'

export function PatientSessions({ patientId }: { patientId: string }) {
  const { i18n, t } = useLingui()
  const { prontuario } = useProntuario()
  const sessoes = [...prontuario.atendimentos].reverse()
  return <section aria-label={t`Sessões do paciente`} className="patient-sessions">
    <div className="professional-header"><h2><Trans>Sessões do paciente</Trans></h2><span className="editorial-meta"><Plural value={sessoes.length} _0="# sessões" one="# sessão" other="# sessões" /></span></div>
    {sessoes.length === 0 ? <p><Trans>Nenhuma sessão ainda. Inicie a primeira a partir de um agendamento de hoje.</Trans></p> :
      <ul>{sessoes.map(sessao => {
        const data = i18n.date(sessao.iniciadoEm, FORMATO_DATA_ATENDIMENTO)
        return <li key={sessao.id}>
          <Link to="/pacientes/$patientId/sessoes/$atendimentoId" params={{ patientId, atendimentoId: sessao.id }} search={{ aba: ABA_INSIGHTS }}><Trans>Sessão de {data}</Trans></Link>{' '}
          <EstadoDoAtendimento atendimentoId={sessao.id} />
        </li>
      })}</ul>}
  </section>
}
