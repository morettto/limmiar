import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KpiStrip } from './KpiStrip'

describe('KpiStrip', () => {
  it('renders every KpiStrip.Item passed as a child', () => {
    render(
      <KpiStrip>
        <KpiStrip.Item label="Pacientes ativos" value="24" />
        <KpiStrip.Item label="Sessões / semana" value="18" />
      </KpiStrip>,
    )

    expect(screen.getByText('Pacientes ativos').textContent).toBe('Pacientes ativos')
    expect(screen.getByText('24').textContent).toBe('24')
    expect(screen.getByText('Sessões / semana').textContent).toBe('Sessões / semana')
    expect(screen.getByText('18').textContent).toBe('18')
  })

  it('renders a non-text ReactNode as the value (e.g. an icon + number)', () => {
    render(
      <KpiStrip>
        <KpiStrip.Item label="Risco elevado" value={<strong>3</strong>} />
      </KpiStrip>,
    )

    const value = screen.getByText('3')
    expect(value.tagName).toBe('STRONG')
  })

  it('lays out D 4-col / T 2-col via xl:grid-cols-4 + md:grid-cols-2 (R6)', () => {
    const { container } = render(
      <KpiStrip>
        <KpiStrip.Item label="a" value="1" />
      </KpiStrip>,
    )

    const strip = container.firstElementChild as HTMLElement
    expect(strip.className).toContain('md:grid-cols-2')
    expect(strip.className).toContain('xl:grid-cols-4')
  })

  it('falls back to a snap-scroll carousel below md (R6 mobile: 1.5 card visible)', () => {
    const { container } = render(
      <KpiStrip>
        <KpiStrip.Item label="a" value="1" />
      </KpiStrip>,
    )

    const strip = container.firstElementChild as HTMLElement
    expect(strip.className).toContain('flex')
    expect(strip.className).toContain('overflow-x-auto')
    expect(strip.className).toContain('snap-x')
    expect(strip.className).toContain('md:snap-none')
  })

  it('sizes each card to ~65% width below md so 1.5 cards are visible, full width from md up', () => {
    render(
      <KpiStrip>
        <KpiStrip.Item label="a" value="1" />
      </KpiStrip>,
    )

    const card = screen.getByText('a').parentElement as HTMLElement
    expect(card.className).toContain('min-w-[65%]')
    expect(card.className).toContain('md:min-w-0')
  })

  it('is keyboard-focusable so the below-md scroll carousel meets WCAG 2.1.1, and defaults its accessible name', () => {
    const { container } = render(
      <KpiStrip>
        <KpiStrip.Item label="a" value="1" />
      </KpiStrip>,
    )

    const strip = container.firstElementChild as HTMLElement
    expect(strip.getAttribute('role')).toBe('group')
    expect(strip.getAttribute('tabindex')).toBe('0')
    expect(strip.getAttribute('aria-label')).toBe('Indicadores')
  })

  it('accepts a custom aria-label for the group', () => {
    const { container } = render(
      <KpiStrip aria-label="Indicadores de risco">
        <KpiStrip.Item label="a" value="1" />
      </KpiStrip>,
    )

    const strip = container.firstElementChild as HTMLElement
    expect(strip.getAttribute('aria-label')).toBe('Indicadores de risco')
  })
})
