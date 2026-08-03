import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdaptiveNav, type AdaptiveNavItem } from './AdaptiveNav'
import { useBreakpoint } from './use-breakpoint'

vi.mock('./use-breakpoint', () => ({ useBreakpoint: vi.fn() }))

const mockedUseBreakpoint = vi.mocked(useBreakpoint)

function item(key: string, label: string, current = false): AdaptiveNavItem {
  return { key, label, icon: <svg data-testid={`icon-${key}`} />, href: `/${key}`, current }
}

const FOUR_ITEMS = [item('painel', 'Painel', true), item('pacientes', 'Pacientes'), item('sessoes', 'Sessões'), item('agenda', 'Agenda')]

const SEVEN_ITEMS = [
  ...FOUR_ITEMS,
  item('notas', 'Notas'),
  item('cobranca', 'Cobrança', true),
  item('privacidade', 'Privacidade'),
]

describe('AdaptiveNav', () => {
  it('renders a full sidebar with icon + label per item at xl (R1: D)', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    render(<AdaptiveNav items={FOUR_ITEMS} />)

    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('w-[150px]')
    for (const it of FOUR_ITEMS) {
      expect(screen.getByRole('link', { name: it.label })).toBeDefined()
    }
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('marks the current item with aria-current="page" at xl', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    render(<AdaptiveNav items={FOUR_ITEMS} />)
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Pacientes' }).getAttribute('aria-current')).toBeNull()
  })

  it('renders a 72px icon-only rail at md/lg, with a toggle for the label drawer (R1: T)', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    render(<AdaptiveNav items={FOUR_ITEMS} />)

    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('w-[72px]')
    // icon-only: accessible name still present via aria-label, no visible text
    const link = screen.getByRole('link', { name: 'Painel' })
    expect(link.textContent).toBe('')

    const toggle = screen.getByRole('button', { name: 'Menu' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Pacientes' }).getAttribute('aria-current')).toBeNull()
  })

  it('opens the labeled drawer at T when the toggle is activated', () => {
    mockedUseBreakpoint.mockReturnValue('lg')
    render(<AdaptiveNav items={FOUR_ITEMS} />)

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    // now 2 links per item exist: the icon-only rail one + the labeled drawer one
    const painelLinks = screen.getAllByRole('link', { name: 'Painel' })
    expect(painelLinks).toHaveLength(2)
    expect(painelLinks.every((el) => el.getAttribute('aria-current') === 'page')).toBe(true)
  })

  it('accepts a custom brandLabel for the T toggle and nav landmark', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    render(<AdaptiveNav items={FOUR_ITEMS} brandLabel="Limmiar" />)
    expect(screen.getByRole('navigation', { name: 'Limmiar' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Limmiar' })).toBeDefined()
  })

  it('renders all items directly in the bottom bar at sm when there are 5 or fewer (R1: M)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<AdaptiveNav items={FOUR_ITEMS} />)

    for (const it of FOUR_ITEMS) {
      expect(screen.getByRole('link', { name: it.label })).toBeDefined()
    }
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Pacientes' }).getAttribute('aria-current')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mais' })).toBeNull()
  })

  it('does not overflow at exactly 5 items — R1 reserves the 5th slot for "Mais" only once there are more than 5', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    const fiveItems = [...FOUR_ITEMS, item('notas', 'Notas')]
    render(<AdaptiveNav items={fiveItems} />)

    for (const it of fiveItems) {
      expect(screen.getByRole('link', { name: it.label })).toBeDefined()
    }
    expect(screen.queryByRole('button', { name: 'Mais' })).toBeNull()
  })

  it('shows exactly 4 items + a "Mais" trigger at sm when there are more than 5 (R1: M overflow)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<AdaptiveNav items={SEVEN_ITEMS} />)

    for (const it of SEVEN_ITEMS.slice(0, 4)) {
      expect(screen.getByRole('link', { name: it.label })).toBeDefined()
    }
    for (const it of SEVEN_ITEMS.slice(4)) {
      expect(screen.queryByRole('link', { name: it.label })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Mais' })).toBeDefined()
  })

  it('reveals the overflow items on "Mais" click, and toggles aria-expanded', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<AdaptiveNav items={SEVEN_ITEMS} />)

    const trigger = screen.getByRole('button', { name: 'Mais' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    for (const it of SEVEN_ITEMS.slice(4)) {
      expect(screen.getByRole('link', { name: it.label })).toBeDefined()
    }
    // 'Cobrança' is the current page and lives in the overflow set — marks
    // aria-current inside the drawer too, not just the always-visible items.
    expect(screen.getByRole('link', { name: 'Cobrança' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Notas' }).getAttribute('aria-current')).toBeNull()
    // the overflow drawer holds only items[4..]; it must not duplicate an
    // always-visible bottom-bar item like 'Painel'.
    expect(screen.getAllByRole('link', { name: 'Painel' })).toHaveLength(1)

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    for (const it of SEVEN_ITEMS.slice(4)) {
      expect(screen.queryByRole('link', { name: it.label })).toBeNull()
    }
  })

  it('accepts a custom moreLabel for the M overflow trigger', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<AdaptiveNav items={SEVEN_ITEMS} moreLabel="Ver mais" />)
    expect(screen.getByRole('button', { name: 'Ver mais' })).toBeDefined()
  })

  it('sizes bottom-bar and rail/drawer touch targets to 44px, sidebar links to the D 32px minimum', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    const { unmount: unmountM } = render(<AdaptiveNav items={FOUR_ITEMS} />)
    expect(screen.getByRole('link', { name: 'Painel' }).className).toContain('min-h-11')
    unmountM()

    mockedUseBreakpoint.mockReturnValue('md')
    const { unmount: unmountT } = render(<AdaptiveNav items={FOUR_ITEMS} />)
    expect(screen.getByRole('link', { name: 'Painel' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: 'Menu' }).className).toContain('min-h-11')
    unmountT()

    mockedUseBreakpoint.mockReturnValue('xl')
    render(<AdaptiveNav items={FOUR_ITEMS} />)
    expect(screen.getByRole('link', { name: 'Painel' }).className).toContain('min-h-8')
  })
})
