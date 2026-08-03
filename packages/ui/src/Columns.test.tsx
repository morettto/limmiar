import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Columns } from './Columns'
import { useBreakpoint } from './use-breakpoint'

vi.mock('./use-breakpoint', () => ({ useBreakpoint: vi.fn() }))

const mockedUseBreakpoint = vi.mocked(useBreakpoint)

function renderColumns() {
  return render(<Columns content={<div>Conteúdo</div>} alert={<div>Alerta</div>} action={<div>Ação</div>} />)
}

describe('Columns', () => {
  it('shows all 3 columns inline at xl, content-first (R2)', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    const { container } = renderColumns()

    expect(screen.getByText('Conteúdo').textContent).toBe('Conteúdo')
    expect(screen.getByText('Alerta').textContent).toBe('Alerta')
    expect(screen.getByText('Ação').textContent).toBe('Ação')
    expect(screen.queryByRole('button')).toBeNull()

    const root = container.firstElementChild as HTMLElement
    const order = Array.from(root.children).map((el) => el.textContent)
    expect(order).toEqual(['Conteúdo', 'Alerta', 'Ação'])
  })

  it('stacks in ação › alerta › conteúdo order at sm (R2)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    const { container } = renderColumns()

    const root = container.firstElementChild as HTMLElement
    const order = Array.from(root.children).map((el) => el.textContent)
    expect(order).toEqual(['Ação', 'Alerta', 'Conteúdo'])
    expect(screen.queryByRole('button')).toBeNull()
  })

  for (const bp of ['md', 'lg'] as const) {
    it(`shows content + alert inline and hides action behind a drawer trigger at ${bp} (R2)`, () => {
      mockedUseBreakpoint.mockReturnValue(bp)
      renderColumns()

      expect(screen.getByText('Conteúdo').textContent).toBe('Conteúdo')
      expect(screen.getByText('Alerta').textContent).toBe('Alerta')
      expect(screen.queryByText('Ação')).toBeNull()
      expect(screen.getByRole('button', { name: 'Mais' })).toBeDefined()
    })
  }

  it('opens the drawer (revealing action) on trigger click, and reflects state via aria-expanded', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    renderColumns()

    const trigger = screen.getByRole('button', { name: 'Mais' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Ação')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Ação').textContent).toBe('Ação')

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Ação')).toBeNull()
  })

  it("aria-controls on the trigger points at the drawer's id once open", () => {
    mockedUseBreakpoint.mockReturnValue('md')
    renderColumns()

    const trigger = screen.getByRole('button', { name: 'Mais' })
    fireEvent.click(trigger)

    const controlsId = trigger.getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()
    expect(document.getElementById(controlsId as string)?.textContent).toBe('Ação')
  })

  it('accepts a custom actionLabel for the drawer trigger', () => {
    mockedUseBreakpoint.mockReturnValue('lg')
    render(
      <Columns
        content={<div>Conteúdo</div>}
        alert={<div>Alerta</div>}
        action={<div>Ação</div>}
        actionLabel="Insights (2)"
      />,
    )

    expect(screen.getByRole('button', { name: 'Insights (2)' })).toBeDefined()
  })

  it('sizes the drawer trigger to the 44px touch-target minimum required at T (R2 + Alvos e densidade)', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    renderColumns()

    const trigger = screen.getByRole('button', { name: 'Mais' })
    expect(trigger.className).toContain('min-h-11')
  })
})
