import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import type { GrupoPaciente } from '../../features/nota-biblioteca/biblioteca'
import type { ResultadoBusca } from '../../features/nota-biblioteca/indice'
import { BibliotecaNotas } from './BibliotecaNotas'

const GRUPOS: readonly GrupoPaciente[] = [
  {
    patientId: 'paciente-1',
    itens: [
      { id: 'nota-1', patientId: 'paciente-1', estado: 'pendente' },
      { id: 'nota-2', patientId: 'paciente-1', estado: 'assinada' },
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

    const itens = screen.getAllByRole('listitem').map((el) => el.textContent)
    expect(itens).toEqual(['nota-1', 'nota-2'])
  })

  it('critério de aceite 3, através do filtro "pronto": a ordem dos grupos e a ordem rascunho-antes-de-assinada dentro de cada grupo sobrevivem a gruposFiltrados', () => {
    const grupos: readonly GrupoPaciente[] = [
      {
        patientId: 'paciente-2',
        itens: [
          { id: 'nota-3', patientId: 'paciente-2', estado: 'pendente' },
          { id: 'nota-4', patientId: 'paciente-2', estado: 'assinada' },
        ],
      },
      {
        patientId: 'paciente-1',
        itens: [
          { id: 'nota-1', patientId: 'paciente-1', estado: 'pendente' },
          { id: 'nota-2', patientId: 'paciente-1', estado: 'assinada' },
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
    expect(within(secaoPaciente2).getAllByRole('listitem').map((el) => el.textContent)).toEqual(['nota-3', 'nota-4'])
    expect(within(secaoPaciente1).getAllByRole('listitem').map((el) => el.textContent)).toEqual(['nota-1', 'nota-2'])
  })

  it('propaga a digitação no campo de busca via onTermoChange', () => {
    const onTermoChange = vi.fn()
    renderWidget({ onTermoChange })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'febre' } })

    expect(onTermoChange).toHaveBeenCalledWith('febre')
  })
})
