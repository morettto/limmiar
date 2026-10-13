import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { FORMATO_DATA_ATENDIMENTO, type Atendimento } from '../../entities/atendimento/atendimento'
import type { Nota } from '../../entities/nota/nota'
import type { Transcricao } from '../../entities/transcricao/transcricao'
import type { Prontuario } from '../../features/prontuario/abrir-prontuario'
import { ProntuarioContext } from '../../features/prontuario/prontuario-context'
import { PatientSessions } from './PatientSessions'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, children }: { to: string; params: { patientId: string; atendimentoId: string }; search: { aba: string }; children: React.ReactNode }) =>
    <a href={`${to.replace('$patientId', params.patientId).replace('$atendimentoId', params.atendimentoId)}?aba=${search.aba}`}>{children}</a>,
}))

beforeAll(async () => dynamicActivate('pt-BR'))
afterEach(cleanup)

const atendimento = (id: string, iniciadoEm: string): Atendimento => ({ id, patientId: 'paciente', agendamentoId: `agendamento-${id}`, iniciadoEm })
const antiga = atendimento('a1', '2026-10-01T12:00:00.000Z'), recente = atendimento('a2', '2026-10-05T14:30:00.000Z')
function montar(prontuario: Partial<Prontuario>) {
  render(<I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: { atendimentos: [], transcricoes: [], notas: [], ...prontuario } as Prontuario, recarregar: async () => {} }}>
    <PatientSessions patientId="paciente" />
  </ProntuarioContext.Provider></I18nProvider>)
}

it('sem sessões explica como começar a primeira', () => {
  montar({})
  expect(screen.getByText('0 sessões')).toBeTruthy()
  expect(screen.getByText('Nenhuma sessão ainda. Inicie a primeira a partir de um agendamento de hoje.')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})

it('lista a sessão mais recente primeiro, com o link para os insights e o estado da transcrição e da nota', () => {
  montar({ atendimentos: [antiga, recente], transcricoes: [{ id: 'a1' } as Transcricao], notas: [{ atendimentoId: 'a1', estado: 'assinada' } as Nota] })
  expect(screen.getByText('2 sessões')).toBeTruthy()
  const links = screen.getAllByRole('link')
  expect(links.map(link => link.textContent)).toEqual([
    `Sessão de ${i18n.date(recente.iniciadoEm, FORMATO_DATA_ATENDIMENTO)}`,
    `Sessão de ${i18n.date(antiga.iniciadoEm, FORMATO_DATA_ATENDIMENTO)}`,
  ])
  expect(links.map(link => link.getAttribute('href'))).toEqual(['/pacientes/paciente/sessoes/a2?aba=insights', '/pacientes/paciente/sessoes/a1?aba=insights'])
  const itens = screen.getAllByRole('listitem')
  expect(screen.getByRole('region', { name: 'Sessões do paciente' })).toBeTruthy()
  expect(itens[0]!.textContent).toBe(`Sessão de ${i18n.date(recente.iniciadoEm, FORMATO_DATA_ATENDIMENTO)} Sem transcrição · Nota pendente`)
  expect(itens[0]!.textContent).toContain('Sem transcrição · Nota pendente')
  expect(itens[1]!.textContent).toContain('Transcrição salva · Nota assinada')
})
