import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import type { GrupoPaciente } from '../../features/nota-biblioteca/biblioteca'
import type { ResultadoBusca } from '../../features/nota-biblioteca/indice'
import { ESTADO_ASSINADA, ESTADO_PENDENTE } from '../../entities/nota/nota'
import { BibliotecaNotas } from './BibliotecaNotas'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, children }: { to: string; params: { patientId: string; atendimentoId: string }; search: { aba: string }; children: React.ReactNode }) =>
    <a href={`${to.replace('$patientId', params.patientId).replace('$atendimentoId', params.atendimentoId)}?aba=${search.aba}`}>{children}</a>,
}))

const GRUPOS: readonly GrupoPaciente[] = [
  {
    patientId: 'paciente-1',
    itens: [
      { id: 'nota-1', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_PENDENTE, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-1', ancoras: [] }] },
      { id: 'nota-2', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_ASSINADA, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-2', ancoras: [] }] },
    ],
  },
]

function renderWidget(props?: Partial<{
  grupos: readonly GrupoPaciente[]
  termo: string
  onTermoChange: (termo: string) => void
  resultado: ResultadoBusca
}>) {
  return render(
    <I18nProvider i18n={i18n}>
      <BibliotecaNotas
        grupos={props?.grupos ?? GRUPOS}
        nomesPacientes={new Map([['paciente-1', 'paciente-1'], ['paciente-2', 'paciente-2']])}
        termo={props?.termo ?? ''}
        onTermoChange={props?.onTermoChange ?? vi.fn()}
        resultado={props?.resultado ?? { estado: 'ocioso' }}
      />
    </I18nProvider>,
  )
}

describe('BibliotecaNotas', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
  })

  it('a-preparar: mostra o status de preparação, os grupos inteiros, e nunca "sem resultados"', () => {
    renderWidget({ resultado: { estado: 'a-preparar' } })

    expect(screen.getByRole('status').textContent).toBe('Preparando a busca...')
    expect(screen.queryByText('Nenhuma nota encontrada.')).toBeNull()
    expect(screen.getByText('nota-1')).toBeTruthy()
    expect(screen.getByText('nota-2')).toBeTruthy()
  })

  it('cada nota leva à aba da nota da sua sessão', () => {
    renderWidget()

    expect(screen.getByRole('link', { name: 'Abrir nota 1' }).getAttribute('href')).toBe('/pacientes/paciente-1/sessoes/atendimento?aba=nota')
    expect(screen.getByRole('link', { name: 'Abrir nota 2' }).getAttribute('href')).toBe('/pacientes/paciente-1/sessoes/atendimento?aba=nota')
  })

  it('pronto com subconjunto de ids: só esses itens aparecem', () => {
    renderWidget({ resultado: { estado: 'pronto', ids: ['nota-1'] } })

    expect(screen.getByText('nota-1')).toBeTruthy()
    expect(screen.queryByText('nota-2')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('pronto com ids vazio: mostra "Nenhuma nota encontrada" e esconde os grupos', () => {
    renderWidget({ resultado: { estado: 'pronto', ids: [] } })

    expect(screen.getByText('Nenhuma nota encontrada.')).toBeTruthy()
    expect(screen.queryByText('nota-1')).toBeNull()
    expect(screen.queryByText('nota-2')).toBeNull()
  })

  it('rascunhos antes das assinadas: o widget preserva a ordem de agruparPorPaciente, não reordena', () => {
    renderWidget({ resultado: { estado: 'ocioso' } })

    const itens = screen.getAllByRole('listitem').map((el) => el.querySelector('dd')?.textContent)
    expect(itens).toEqual(['nota-1', 'nota-2'])
  })

  it('critério de aceite 3, através do filtro "pronto": a ordem dos grupos e a ordem rascunho-antes-de-assinada dentro de cada grupo sobrevivem a gruposFiltrados', () => {
    const grupos: readonly GrupoPaciente[] = [
      {
        patientId: 'paciente-2',
        itens: [
          { id: 'nota-3', patientId: 'paciente-2', atendimentoId: 'atendimento', estado: ESTADO_PENDENTE, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-3', ancoras: [] }] },
          { id: 'nota-4', patientId: 'paciente-2', atendimentoId: 'atendimento', estado: ESTADO_ASSINADA, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-4', ancoras: [] }] },
        ],
      },
      {
        patientId: 'paciente-1',
        itens: [
          { id: 'nota-1', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_PENDENTE, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-1', ancoras: [] }] },
          { id: 'nota-2', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_ASSINADA, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-2', ancoras: [] }] },
        ],
      },
    ]
    // `ids` inclui todos os itens dos dois grupos, numa ordem embaralhada que não bate com a
    // ordem de `grupos` nem com a de `itens` dentro de cada grupo -- só a ordem que sobrevive
    // é a que `agruparPorPaciente` já tinha decidido, nunca a de `ids`.
    renderWidget({
      grupos,
      resultado: { estado: 'pronto', ids: ['nota-2', 'nota-4', 'nota-1', 'nota-3'] },
    })

    const secoes = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent)
    expect(secoes).toEqual(['paciente-2', 'paciente-1'])

    const secaoPaciente2 = screen.getByRole('region', { name: 'paciente-2' })
    const secaoPaciente1 = screen.getByRole('region', { name: 'paciente-1' })
    expect(within(secaoPaciente2).getAllByRole('listitem').map((el) => el.querySelector('dd')?.textContent)).toEqual(['nota-3', 'nota-4'])
    expect(within(secaoPaciente1).getAllByRole('listitem').map((el) => el.querySelector('dd')?.textContent)).toEqual(['nota-1', 'nota-2'])
  })

  it('pronto com ids que só batem no primeiro grupo: o grupo vazio não é renderizado', () => {
    const grupos: readonly GrupoPaciente[] = [
      {
        patientId: 'paciente-1',
        itens: [{ id: 'nota-1', patientId: 'paciente-1', atendimentoId: 'atendimento', estado: ESTADO_PENDENTE, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-1', ancoras: [] }] }],
      },
      {
        patientId: 'paciente-2',
        itens: [{ id: 'nota-3', patientId: 'paciente-2', atendimentoId: 'atendimento', estado: ESTADO_PENDENTE, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'nota-3', ancoras: [] }] }],
      },
    ]
    renderWidget({ grupos, resultado: { estado: 'pronto', ids: ['nota-1'] } })

    expect(screen.getByRole('region', { name: 'paciente-1' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'paciente-2' })).toBeNull()
  })

  it('propaga a digitação no campo de busca via onTermoChange', () => {
    const onTermoChange = vi.fn()
    renderWidget({ onTermoChange })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'febre' } })

    expect(onTermoChange).toHaveBeenCalledWith('febre')
  })

  it('cada nota mostra o estado, o travessão e a revisão contada a partir de 1', () => {
    const grupos: readonly GrupoPaciente[] = [{ patientId: 'paciente-1', itens: [
      { id: 'a', patientId: 'paciente-1', atendimentoId: 'x', estado: ESTADO_PENDENTE, revisao: 0, frases: [{ id: 'S-0', secao: 'S', texto: 'a', ancoras: [] }] },
      { id: 'b', patientId: 'paciente-1', atendimentoId: 'x', estado: ESTADO_ASSINADA, revisao: 2, frases: [{ id: 'S-0', secao: 'S', texto: 'b', ancoras: [] }] },
    ] }]
    renderWidget({ grupos })
    const itens = screen.getAllByRole('listitem')
    expect(within(itens[0]!).getByText(/Rascunho/).textContent).toBe('Rascunho — Revisão 1')
    expect(within(itens[1]!).getByText(/Assinada/).textContent).toBe('Assinada — Revisão 3')
  })
})
