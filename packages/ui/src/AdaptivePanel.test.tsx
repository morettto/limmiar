import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdaptivePanel } from './AdaptivePanel'
import { useBreakpoint } from './use-breakpoint'

vi.mock('./use-breakpoint', () => ({ useBreakpoint: vi.fn() }))

const mockedUseBreakpoint = vi.mocked(useBreakpoint)

function renderPanel() {
  return render(<AdaptivePanel label="Sinais">Ritmo de fala: 163 wpm</AdaptivePanel>)
}

describe('AdaptivePanel', () => {
  it('uses the inline collapsible-strip wrapper at sm, not the T drawer-overlay wrapper', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    const { container } = renderPanel()

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('rounded-lg')
    expect(wrapper.className).not.toBe('relative')
  })

  it('uses the drawer-overlay wrapper at T (md/lg), not the M inline-strip wrapper', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    const { container } = renderPanel()

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toBe('relative')
  })

  it('is always visible as a fixed column at xl, with no disclosure trigger (R5: D)', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    renderPanel()

    expect(screen.getByText('Ritmo de fala: 163 wpm').textContent).toBe('Ritmo de fala: 163 wpm')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses label as the accessible name of the fixed column at xl', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    renderPanel()
    expect(screen.getByLabelText('Sinais')).toBeDefined()
  })

  for (const bp of ['md', 'lg'] as const) {
    it(`is closed by default behind a drawer trigger at ${bp} (R5: T)`, () => {
      mockedUseBreakpoint.mockReturnValue(bp)
      renderPanel()

      expect(screen.queryByText('Ritmo de fala: 163 wpm')).toBeNull()
      const trigger = screen.getByRole('button', { name: 'Sinais' })
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })

    it(`opens the drawer on trigger click at ${bp}`, () => {
      mockedUseBreakpoint.mockReturnValue(bp)
      renderPanel()

      fireEvent.click(screen.getByRole('button', { name: 'Sinais' }))
      expect(screen.getByText('Ritmo de fala: 163 wpm').textContent).toBe('Ritmo de fala: 163 wpm')
      expect(screen.getByRole('button', { name: 'Sinais' }).getAttribute('aria-expanded')).toBe('true')
    })
  }

  it('is closed by default behind a collapsible strip trigger at sm (R5: M)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    renderPanel()

    expect(screen.queryByText('Ritmo de fala: 163 wpm')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sinais' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('expands the strip in place on trigger click at sm', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Sinais' }))
    expect(screen.getByText('Ritmo de fala: 163 wpm').textContent).toBe('Ritmo de fala: 163 wpm')
  })

  it('toggles closed again on a 2nd trigger click', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    renderPanel()

    const trigger = screen.getByRole('button', { name: 'Sinais' })
    fireEvent.click(trigger)
    fireEvent.click(trigger)

    expect(screen.queryByText('Ritmo de fala: 163 wpm')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it("aria-controls on the T-mode trigger points at the drawer's own id once open", () => {
    mockedUseBreakpoint.mockReturnValue('md')
    renderPanel()

    const trigger = screen.getByRole('button', { name: 'Sinais' })
    fireEvent.click(trigger)

    const controlsId = trigger.getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()
    expect(document.getElementById(controlsId as string)?.textContent).toBe('Ritmo de fala: 163 wpm')
  })

  for (const bp of ['sm', 'md', 'lg'] as const) {
    it(`sizes the ${bp} trigger to the 44px touch-target minimum`, () => {
      mockedUseBreakpoint.mockReturnValue(bp)
      renderPanel()
      expect(screen.getByRole('button', { name: 'Sinais' }).className).toContain('min-h-11')
    })
  }
})
