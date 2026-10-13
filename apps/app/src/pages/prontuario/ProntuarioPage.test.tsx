import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import type { Prontuario } from '../../features/prontuario/abrir-prontuario'
import { ProntuarioContext } from '../../features/prontuario/prontuario-context'
import { ProntuarioPage } from './ProntuarioPage'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))
const montagens = vi.hoisted(() => ({ hoje: 0 }))
vi.mock('../../features/prontuario/HojeDoPaciente', async () => {
  const { useEffect } = await import('react')
  return { HojeDoPaciente: ({ patientId, destaque }: { patientId: string; destaque?: string }) => {
    useEffect(() => { montagens.hoje += 1 }, [])
    return <div>Hoje de {patientId} destaque {destaque ?? 'nenhum'}</div>
  } }
})
vi.mock('../../widgets/patient-care/PatientSessions', () => ({ PatientSessions: ({ patientId }: { patientId: string }) => <div>Sessões de {patientId}</div> }))
vi.mock('../../features/patient-schedule/PatientSchedule', () => ({ PatientSchedule: ({ patientId, iniciadas, onChanged }: { patientId: string; iniciadas: ReadonlySet<string>; onChanged(): void }) => <div>
  Agenda de {patientId} com sessão em {[...iniciadas].join(',') || 'nenhum'}<button onClick={onChanged}>Agenda alterada</button>
</div> }))
vi.mock('../../widgets/patient-care/PatientAccess', () => ({ PatientAccess: ({ patientId }: { patientId: string }) => <div>Acesso de {patientId}</div> }))

function pagina(agendamento?: string, atendimentos = [{ agendamentoId: 'agendamento-1' }, { agendamentoId: 'agendamento-2' }]) {
  return <I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: { nome: 'Maria Souza', atendimentos } as Prontuario, recarregar: async () => {} }}>
    <ProntuarioPage baseUrl="" accountId="conta-1" accessToken="access" patientId="paciente-1" agendamento={agendamento} />
  </ProntuarioContext.Provider></I18nProvider>
}
function montar(agendamento?: string) { return render(pagina(agendamento)) }

describe('ProntuarioPage', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); montagens.hoje = 0 })

  it('nomeia a pasta, mostra o caminho de volta e foca o título', () => {
    montar()
    expect(screen.getByRole('navigation', { name: 'Você está em' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pacientes' }).getAttribute('href')).toBe('/pacientes')
    const titulo = screen.getByRole('heading', { level: 1, name: 'Maria Souza' })
    expect(screen.getByRole('listitem', { current: 'page' }).textContent).toBe('Maria Souza')
    expect(document.activeElement).toBe(titulo)
    expect(titulo.tabIndex).toBe(-1)
  })

  it('atualiza as sessões já iniciadas quando os atendimentos do prontuário mudam', () => {
    const { rerender } = montar()
    expect(screen.getByText(/Agenda de paciente-1 com sessão em agendamento-1,agendamento-2/)).toBeTruthy()
    rerender(pagina(undefined, [{ agendamentoId: 'agendamento-9' }]))
    expect(screen.getByText(/Agenda de paciente-1 com sessão em agendamento-9/)).toBeTruthy()
  })

  it('compõe hoje, sessões, agenda e acesso do mesmo paciente e entrega o agendamento do painel', () => {
    montar('agendamento-7')
    expect(screen.getByText('Hoje de paciente-1 destaque agendamento-7')).toBeTruthy()
    expect(screen.getByText('Sessões de paciente-1')).toBeTruthy()
    expect(screen.getByText('Agenda de paciente-1 com sessão em agendamento-1,agendamento-2')).toBeTruthy()
    expect(screen.getByText('Acesso de paciente-1')).toBeTruthy()
  })

  it('sem agendamento do painel não destaca nenhum', () => {
    montar()
    expect(screen.getByText('Hoje de paciente-1 destaque nenhum')).toBeTruthy()
  })

  it('relê o que acontece hoje quando a agenda do paciente muda', () => {
    montar()
    expect(montagens.hoje).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Agenda alterada' }))
    expect(montagens.hoje).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Agenda alterada' }))
    expect(montagens.hoje).toBe(3)
  })
})
