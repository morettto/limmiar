import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdaptiveTable } from './AdaptiveTable'
import { useBreakpoint } from './use-breakpoint'

vi.mock('./use-breakpoint', () => ({ useBreakpoint: vi.fn() }))

const mockedUseBreakpoint = vi.mocked(useBreakpoint)

const COLUMNS = [
  { key: 'name', header: 'Paciente' },
  { key: 'risk', header: 'Risco' },
  { key: 'next', header: 'Próxima', secondary: true },
  { key: 'last', header: 'Última', secondary: true },
]

const ROWS = [
  { key: 'p1', cells: ['David Okafor', 'Elevado', 'Sex 14:30', 'ontem'] },
  { key: 'p2', cells: ['Amelia Hartwell', 'Moderado', 'Qui 10:00', '2 dias'] },
]

describe('AdaptiveTable', () => {
  it('renders a <table> at xl (R3: D uses table layout)', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)
    expect(screen.getByRole('table')).toBeDefined()
  })

  it('renders a <table> at lg (R3: T paisagem still uses table layout)', () => {
    mockedUseBreakpoint.mockReturnValue('lg')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)
    expect(screen.getByRole('table')).toBeDefined()
  })

  it('renders a card list at md (R3: T retrato collapses to cards)', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('list').children).toHaveLength(2)
  })

  it('renders a card list at sm (R3: M collapses to cards)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('list').children).toHaveLength(2)
  })

  it('table mode: each <tr> carries the pointer-coarse:h-11 class (44px touch target, AC "AdaptiveTable verde ... alvo 44px em pointer:coarse")', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)

    for (const row of screen.getAllByRole('row').slice(1)) {
      expect(row.className).toContain('pointer-coarse:h-11')
    }
  })

  it('table mode: one <th> per column, in order, and cells aligned to their column', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['Paciente', 'Risco', 'Próxima', 'Última'])

    const firstRow = screen.getAllByRole('row')[1]
    const cells = Array.from(firstRow.children).map((td) => td.textContent)
    expect(cells).toEqual(['David Okafor', 'Elevado', 'Sex 14:30', 'ontem'])
  })

  it('card mode: secondary columns collapse into a 2nd line, primary stay on the 1st', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<AdaptiveTable columns={COLUMNS} rows={ROWS} />)

    const card = screen.getByText('David Okafor').closest('li') as HTMLElement
    const [primaryLine, secondaryLine] = Array.from(card.children) as HTMLElement[]

    expect(primaryLine.textContent).toBe('David OkaforElevado')
    expect(secondaryLine.textContent).toBe('Sex 14:30ontem')
  })

  it('card mode: omits the 2nd line entirely when there are no secondary columns', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    const primaryOnly = COLUMNS.map((column) => ({ key: column.key, header: column.header }))
    render(<AdaptiveTable columns={primaryOnly} rows={ROWS} />)

    const card = screen.getByText('David Okafor').closest('li') as HTMLElement
    expect(card.children).toHaveLength(1)
  })

  it('passes caption through as the accessible name in both layouts', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    const { rerender } = render(<AdaptiveTable columns={COLUMNS} rows={ROWS} caption="Carteira de pacientes" />)
    expect(screen.getByRole('table', { name: 'Carteira de pacientes' })).toBeDefined()

    mockedUseBreakpoint.mockReturnValue('sm')
    rerender(<AdaptiveTable columns={COLUMNS} rows={ROWS} caption="Carteira de pacientes" />)
    expect(screen.getByRole('list', { name: 'Carteira de pacientes' })).toBeDefined()
  })
})
