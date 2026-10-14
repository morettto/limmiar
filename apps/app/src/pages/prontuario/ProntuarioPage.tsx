import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import { HojeDoPaciente } from '../../features/prontuario/HojeDoPaciente'
import { useProntuario } from '../../features/prontuario/prontuario-context'
import { PatientSchedule } from '../../features/patient-schedule/PatientSchedule'
import { PatientAccess } from '../../widgets/patient-care/PatientAccess'
import { PatientSessions } from '../../widgets/patient-care/PatientSessions'

export interface ProntuarioPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
  /** Agendamento vindo do painel: ganha destaque e o foco em "Iniciar sessão". */
  agendamento?: string
}

export function ProntuarioPage({ baseUrl, accountId, accessToken, patientId, agendamento }: ProntuarioPageProps) {
  const { t } = useLingui()
  const { prontuario } = useProntuario()
  const [versaoAgenda, setVersaoAgenda] = useState(0)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const iniciadas = useMemo(() => new Set(prontuario.atendimentos.map(atendimento => atendimento.agendamentoId)), [prontuario.atendimentos])

  // Stryker disable next-line ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => { tituloRef.current!.focus() }, [])

  // Stryker disable next-line ArithmeticOperator: equivalent, the key only has to differ from the previous one.
  const agendaMudou = () => setVersaoAgenda(valor => valor + 1)

  return <main id="app-shell" className="workspace">
    <header>
      <nav aria-label={t`Você está em`}>
        <ol className="flex list-none flex-wrap items-center gap-2 p-0">
          <li><Link to="/pacientes"><Trans>Pacientes</Trans></Link></li>
          <li aria-current="page">{prontuario.nome}</li>
        </ol>
      </nav>
      <h1 ref={tituloRef} tabIndex={-1}>{prontuario.nome}</h1>
    </header>
    <HojeDoPaciente key={versaoAgenda} baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} destaque={agendamento} />
    <PatientSessions patientId={patientId} />
    <PatientSchedule baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} iniciadas={iniciadas} onChanged={agendaMudou} />
    <PatientAccess baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} />
  </main>
}
