import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { FORMATO_DATA_ATENDIMENTO, type Atendimento } from '../../entities/atendimento/atendimento'
import type { Nota } from '../../entities/nota/nota'
import type { PropostaReferencia } from '../../entities/nota/referencia'
import type { Transcricao } from '../../entities/transcricao/transcricao'
import type { Prontuario } from '../../features/prontuario/abrir-prontuario'
import { ProntuarioContext } from '../../features/prontuario/prontuario-context'
import { AtendimentoPage, type AtendimentoPageProps } from './AtendimentoPage'

type Bloqueio = { shouldBlockFn(args: { current: { pathname: string }; next: { pathname: string } }): boolean; disabled: boolean; enableBeforeUnload: boolean }
const roteador = vi.hoisted(() => ({ bloqueio: null as unknown, navegar: vi.fn(), travarNavegacao: vi.fn() }))
const bloqueio = () => roteador.bloqueio as Bloqueio

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, children, ...resto }: { to: string; params?: { patientId: string; atendimentoId?: string }; search?: { aba: string }; children: React.ReactNode; 'aria-current'?: string }) =>
    <a href={`${to.replace('$patientId', params?.patientId ?? '').replace('$atendimentoId', params?.atendimentoId ?? '')}${search ? `?aba=${search.aba}` : ''}`} aria-current={resto['aria-current'] as 'page' | undefined}>{children}</a>,
  useNavigate: () => roteador.navegar,
  useBlocker: (opcoes: unknown) => { roteador.bloqueio = opcoes },
}))
vi.mock('../../widgets/app-shell/bloqueio', () => ({ useBloquearNavegacao: roteador.travarNavegacao }))
vi.mock('../../widgets/patient-care/ConsentimentoPaciente', () => ({ ConsentimentoPaciente: ({ patientId }: { patientId: string }) => <div>Consentimento de {patientId}</div> }))
vi.mock('../../features/prontuario/EstadoDoAtendimento', () => ({ EstadoDoAtendimento: ({ atendimentoId }: { atendimentoId: string }) => <p>Estado de {atendimentoId}</p> }))
vi.mock('../../features/live-session/SessionReview', () => ({ SessionReview: ({ paciente, atendimentoId, transcricao, onPendingChange, onSaved, onPropostaReferencia }: {
  paciente: { id: string; nome: string; transcricoes: Transcricao[] }; atendimentoId: string; transcricao?: Transcricao; onPendingChange(pendente: boolean): void
  onSaved(transcricao: Transcricao): void; onPropostaReferencia(proposta: PropostaReferencia): void }) => <div>
  <p>Gravação de {paciente.nome} sessão {atendimentoId} revisão {transcricao?.revisao ?? 'nenhuma'} de {paciente.transcricoes.length} no prontuário</p>
  <button onClick={() => onPendingChange(true)}>Capturar</button><button onClick={() => onPendingChange(false)}>Confirmar salvamento</button>
  <button onClick={() => onSaved({} as Transcricao)}>Salvar transcrição</button>
  <button onClick={() => onPropostaReferencia(proposta)}>Propor referência</button>
</div> }))
vi.mock('../../widgets/online-session/OnlineSession', () => ({ OnlineSession: ({ patientId, atendimentoId, onPendingChange }: { patientId: string; atendimentoId: string; onPendingChange(pendente: boolean): void }) => <div>
  Chamada de {patientId} sessão {atendimentoId}<button onClick={() => onPendingChange(true)}>Conectar chamada</button><button onClick={() => onPendingChange(false)}>Salvar chamada</button>
</div> }))
vi.mock('../../features/nota-editor/NotaDoAtendimento', () => ({ NotaDoAtendimento: ({ nota, transcricoes, analiseAutorizada, ativa, propostaReferencia, dek, onDescartarProposta, onAbrirTranscricao, onSaved }: {
  nota?: Nota; transcricoes: Transcricao[]; analiseAutorizada: boolean; ativa: boolean; propostaReferencia: PropostaReferencia | null; dek: unknown
  onDescartarProposta(): void; onAbrirTranscricao(): void; onSaved(): void }) => <div>
  <p>Nota {nota?.id ?? 'nenhuma'} com {transcricoes.length} revisões, análise {String(analiseAutorizada)}, ativa {String(ativa)}, dek {String(dek === chave)}</p>
  {propostaReferencia && <><p>Referência de {propostaReferencia.patientId}</p><button onClick={onDescartarProposta}>Cancelar proposta</button></>}
  <button onClick={onAbrirTranscricao}>Ver fala</button><button onClick={onSaved}>Nota salva</button>
</div> }))

const chave = {} as CryptoKey
const proposta: PropostaReferencia = { patientId: 'paciente-1', inicioMs: 0, fimMs: 500, referencia: { trechoId: 'fonte', titulo: 'Livro', autor: 'Autor', pagina: 1, paragrafo: 1,
  citacaoLiteral: 'Citação', transcriptId: 'atendimento-1', revisaoTranscricao: 0, frasePaciente: 'Fala.' } }
const atendimento: Atendimento = { id: 'atendimento-1', patientId: 'paciente-1', agendamentoId: 'agendamento-1', iniciadoEm: '2026-10-05T14:30:00.000Z' }
const revisao = (id: string, numero: number) => ({ id, revisao: numero }) as Transcricao
const recarregar = vi.fn(async () => {})

function prontuario(extras: Partial<Prontuario> = {}): Prontuario {
  return { nome: 'Maria Souza', dek: chave, atendimentos: [atendimento], transcricoes: [], notas: [], consentimentos: { gravacao: 'concedido', analiseIa: 'concedido' }, ...extras } as Prontuario
}
const props = (extras: Partial<AtendimentoPageProps> = {}): AtendimentoPageProps => ({ baseUrl: '', accountId: 'conta-1', accessToken: 'access', kek: chave, patientId: 'paciente-1', atendimentoId: 'atendimento-1', aba: 'insights', ...extras })
function montar(estado: Prontuario = prontuario(), extras: Partial<AtendimentoPageProps> = {}) {
  return render(<I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: estado, recarregar }}><AtendimentoPage {...props(extras)} /></ProntuarioContext.Provider></I18nProvider>)
}
const painel = (texto: string) => screen.getByText(texto, { exact: false }).closest('[hidden], main') as HTMLElement

describe('AtendimentoPage', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('sem a sessão na pasta do paciente avisa e leva de volta à pasta', () => {
    montar(prontuario(), { atendimentoId: 'inexistente' })
    expect(screen.getByRole('alert').textContent).toBe('Não encontramos esta sessão na pasta do paciente.')
    expect(screen.getByRole('link', { name: 'Voltar à pasta do paciente' }).getAttribute('href')).toBe('/pacientes/paciente-1')
    expect(screen.queryByText(/Gravação de/)).toBeNull()
  })

  it('nomeia a sessão pela data, mostra o caminho de volta, o estado e foca o título', () => {
    montar()
    const data = i18n.date(atendimento.iniciadoEm, FORMATO_DATA_ATENDIMENTO)
    const titulo = screen.getByRole('heading', { level: 1, name: `Sessão de ${data}` })
    expect(document.activeElement).toBe(titulo)
    expect(screen.getByRole('link', { name: 'Pacientes' }).getAttribute('href')).toBe('/pacientes')
    expect(screen.getByRole('link', { name: 'Maria Souza' }).getAttribute('href')).toBe('/pacientes/paciente-1')
    expect(screen.getByRole('listitem', { current: 'page' }).textContent).toBe(`Sessão de ${data}`)
    expect(screen.getByText('Estado de atendimento-1')).toBeTruthy()
  })

  it.each([['insights', 'Insights', 'Nota'], ['nota', 'Nota', 'Insights']] as const)('na aba %s marca só a aba ativa e esconde o outro painel sem desmontá-lo', (aba, ativa, inativa) => {
    montar(prontuario(), { aba })
    const abas = screen.getByRole('navigation', { name: 'Seções da sessão' })
    expect(abas.querySelector('a[aria-current="page"]')!.textContent).toBe(ativa)
    expect(screen.getByRole('link', { name: inativa }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Insights' }).getAttribute('href')).toBe('/pacientes/paciente-1/sessoes/atendimento-1?aba=insights')
    expect(screen.getByRole('link', { name: 'Nota' }).getAttribute('href')).toBe('/pacientes/paciente-1/sessoes/atendimento-1?aba=nota')
    expect(painel('Gravação de').hidden).toBe(aba === 'nota')
    expect(painel('Nota nenhuma').hidden).toBe(aba === 'insights')
    expect(screen.getByText('Consentimento de paciente-1')).toBeTruthy()
  })

  it('abre a gravação com a última revisão desta sessão e a nota que já existe para ela', () => {
    const nota = { id: 'nota-9', atendimentoId: 'atendimento-1' } as Nota
    montar(prontuario({ transcricoes: [revisao('atendimento-1', 0), revisao('outra', 0), revisao('atendimento-1', 1)],
      notas: [{ id: 'nota-outra', atendimentoId: 'outra' } as Nota, nota], consentimentos: { gravacao: 'concedido', analiseIa: 'revogado' } }))
    expect(screen.getByText('Gravação de Maria Souza sessão atendimento-1 revisão 1 de 3 no prontuário')).toBeTruthy()
    expect(screen.getByText('Nota nota-9 com 2 revisões, análise false, ativa false, dek true')).toBeTruthy()
  })

  it('com transcrição salva não oferece escolher a modalidade nem a chamada online', () => {
    montar(prontuario({ transcricoes: [revisao('atendimento-1', 0)] }))
    expect(screen.queryByLabelText('Tipo de sessão')).toBeNull()
    expect(screen.getByText(/Gravação de/)).toBeTruthy()
    expect(screen.queryByText(/Chamada de/)).toBeNull()
  })

  it('escolhe a modalidade dentro da sessão e a trava enquanto há texto ou chamada pendente', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Tipo de sessão'), { target: { value: 'online' } })
    expect(screen.getByText('Chamada de paciente-1 sessão atendimento-1')).toBeTruthy()
    expect(screen.queryByText(/Gravação de/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Conectar chamada' }))
    expect(screen.getByLabelText('Tipo de sessão')).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar chamada' }))
    fireEvent.change(screen.getByLabelText('Tipo de sessão'), { target: { value: 'presencial' } })
    expect(screen.getByText(/Gravação de/)).toBeTruthy()
  })

  it('leva a referência proposta à aba da nota e a descarta ao cancelar ou ao voltar a capturar', () => {
    montar()
    expect(screen.queryByText('Referência de paciente-1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Propor referência' }))
    expect(roteador.navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId: 'paciente-1', atendimentoId: 'atendimento-1' }, search: { aba: 'nota' } })
    expect(screen.getByText('Referência de paciente-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar proposta', hidden: true }))
    expect(screen.queryByText('Referência de paciente-1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Propor referência' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capturar' }))
    expect(screen.queryByText('Referência de paciente-1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar salvamento' }))
    expect(screen.queryByText('Referência de paciente-1')).toBeNull()
  })

  it('ver a fala da referência volta à aba dos insights da mesma sessão', () => {
    montar(prontuario(), { aba: 'nota' })
    fireEvent.click(screen.getByRole('button', { name: 'Ver fala' }))
    expect(roteador.navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId: 'paciente-1', atendimentoId: 'atendimento-1' }, search: { aba: 'insights' } })
  })

  it('relê o prontuário depois de salvar a transcrição ou a nota e avisa se a releitura falha', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    expect(recarregar).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
    recarregar.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nota salva', hidden: true })) })
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível atualizar o prontuário. Recarregue a página.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nota salva', hidden: true })) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('só pede confirmação ao sair da página com gravação ou texto pendente', () => {
    const confirmar = vi.spyOn(window, 'confirm')
    montar()
    expect(bloqueio().disabled).toBe(true)
    expect(bloqueio().enableBeforeUnload).toBe(false)
    expect(roteador.travarNavegacao).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Capturar' }))
    expect(bloqueio().disabled).toBe(false)
    expect(roteador.travarNavegacao).toHaveBeenLastCalledWith(true)
    const de = { pathname: '/pacientes/paciente-1/sessoes/atendimento-1' }
    expect(bloqueio().shouldBlockFn({ current: de, next: { pathname: de.pathname } })).toBe(false)
    expect(confirmar).not.toHaveBeenCalled()
    confirmar.mockReturnValueOnce(false)
    expect(bloqueio().shouldBlockFn({ current: de, next: { pathname: '/' } })).toBe(true)
    expect(confirmar).toHaveBeenCalledWith('Há uma gravação ou alterações sem salvar. Sair agora as descarta. Deseja sair?')
    confirmar.mockReturnValueOnce(true)
    expect(bloqueio().shouldBlockFn({ current: de, next: { pathname: '/' } })).toBe(false)
    confirmar.mockRestore()
  })

  it('abre na modalidade presencial, sem aviso de releitura, com a seção de consentimento nomeada e o título só focável por código', () => {
    montar()
    expect(screen.getByLabelText('Tipo de sessão')).toHaveProperty('value', 'presencial')
    expect(screen.getByRole('region', { name: 'Consentimento e tipo de sessão' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).tabIndex).toBe(-1)
  })

  it('a análise só vale com consentimento concedido e a nota sabe quando a aba está ativa', () => {
    montar(prontuario(), { aba: 'nota' })
    expect(screen.getByText('Nota nenhuma com 0 revisões, análise true, ativa true, dek true')).toBeTruthy()
  })

  it('uma pendência que acaba não descarta a referência proposta', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Propor referência' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar salvamento' }))
    expect(screen.getByText('Referência de paciente-1')).toBeTruthy()
  })

  it('acompanha o prontuário e as props novas: transcrições, paciente, releitura e navegação', () => {
    const novoRecarregar = vi.fn(async () => {})
    const view = montar(prontuario({ transcricoes: [revisao('atendimento-1', 0)] }))
    expect(screen.getByText('Nota nenhuma com 1 revisões, análise true, ativa false, dek true')).toBeTruthy()
    view.rerender(<I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: prontuario({ nome: 'Maria Silva', transcricoes: [revisao('atendimento-1', 0), revisao('atendimento-1', 1)] }), recarregar: novoRecarregar }}>
      <AtendimentoPage {...props({ patientId: 'paciente-2' })} /></ProntuarioContext.Provider></I18nProvider>)
    expect(screen.getByText('Nota nenhuma com 2 revisões, análise true, ativa false, dek true')).toBeTruthy()
    expect(screen.getByText('Gravação de Maria Silva sessão atendimento-1 revisão 1 de 2 no prontuário')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar transcrição' }))
    expect(novoRecarregar).toHaveBeenCalledOnce()
    expect(recarregar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ver fala', hidden: true }))
    expect(roteador.navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId: 'paciente-2', atendimentoId: 'atendimento-1' }, search: { aba: 'insights' } })
    fireEvent.click(screen.getByRole('button', { name: 'Propor referência' }))
    expect(roteador.navegar).toHaveBeenLastCalledWith({ to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId: 'paciente-2', atendimentoId: 'atendimento-1' }, search: { aba: 'nota' } })
  })
})
