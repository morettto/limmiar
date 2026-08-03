import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarViewport } from './CalendarViewport'
import { useBreakpoint } from './use-breakpoint'

vi.mock('./use-breakpoint', () => ({ useBreakpoint: vi.fn() }))

const mockedUseBreakpoint = vi.mocked(useBreakpoint)

// 7 consecutive UTC days, so weekday/day formatting is deterministic across
// machine timezones.
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i)))

function daySlot(day: Date) {
  return <div data-testid={`slot-${day.toISOString()}`}>slot {day.getUTCDate()}</div>
}

const CONTENT = WEEK.map(daySlot)

describe('CalendarViewport', () => {
  it('shows a 5-day window at xl (R8)', () => {
    mockedUseBreakpoint.mockReturnValue('xl')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
    expect(screen.getByRole('group', { name: 'Dias' }).children).toHaveLength(5)
  })

  it('shows a 5-day window at lg — tracks xl, not md/sm (R8)', () => {
    mockedUseBreakpoint.mockReturnValue('lg')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
    expect(screen.getByRole('group', { name: 'Dias' }).children).toHaveLength(5)
  })

  it('shows a 3-day window at md (R8)', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
    expect(screen.getByRole('group', { name: 'Dias' }).children).toHaveLength(3)
  })

  it('shows a 1-day window at sm, plus a date selector covering the full range (R8)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
    expect(screen.getByRole('group', { name: 'Dias' }).children).toHaveLength(1)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.options).toHaveLength(WEEK.length)
  })

  it('does not render the date selector at md/lg/xl', () => {
    for (const bp of ['md', 'lg', 'xl'] as const) {
      mockedUseBreakpoint.mockReturnValue(bp)
      const { unmount } = render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
      expect(screen.queryByRole('combobox')).toBeNull()
      unmount()
    }
  })

  it('calls onFocusedDayIndexChange with the selected index', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    const onChange = vi.fn()
    render(
      <CalendarViewport days={WEEK} onFocusedDayIndexChange={onChange}>
        {CONTENT}
      </CalendarViewport>,
    )

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('tolerates a missing onFocusedDayIndexChange (day selection is optional to observe)', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)

    expect(() => fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } })).not.toThrow()
  })

  it('anchors the visible window at focusedDayIndex', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    render(
      <CalendarViewport days={WEEK} focusedDayIndex={2}>
        {CONTENT}
      </CalendarViewport>,
    )

    // days[2..4] (3-day window starting at index 2)
    expect(screen.getByTestId(`slot-${WEEK[2].toISOString()}`)).toBeDefined()
    expect(screen.getByTestId(`slot-${WEEK[4].toISOString()}`)).toBeDefined()
    expect(screen.queryByTestId(`slot-${WEEK[0].toISOString()}`)).toBeNull()
  })

  it('clamps the window so it never runs past the end of days', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    // focusedDayIndex points at the last day; a naive slice(6, 9) would
    // yield a 1-day window instead of the full 3-day one.
    render(
      <CalendarViewport days={WEEK} focusedDayIndex={WEEK.length - 1}>
        {CONTENT}
      </CalendarViewport>,
    )

    expect(screen.getByRole('group', { name: 'Dias' }).children).toHaveLength(3)
    expect(screen.getByTestId(`slot-${WEEK[4].toISOString()}`)).toBeDefined()
    expect(screen.getByTestId(`slot-${WEEK[6].toISOString()}`)).toBeDefined()
  })

  it('keeps each column aligned with its day when the window is anchored (not just the first N children)', () => {
    mockedUseBreakpoint.mockReturnValue('md')
    render(
      <CalendarViewport days={WEEK} focusedDayIndex={2}>
        {CONTENT}
      </CalendarViewport>,
    )

    // If content were sliced independently of `start` (e.g. always
    // content.slice(0, visibleCount)), this would show days[2..4]'s dates
    // but days[0..2]'s slot content — catch that misalignment explicitly.
    expect(screen.getByText('slot 4').textContent).toBe('slot 4')
    expect(screen.queryByText('slot 2')).toBeNull()
  })

  it('renders each visible day column', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
    expect(screen.getByText('slot 2').textContent).toBe('slot 2')
  })

  it('formats day labels with Intl by default', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(<CalendarViewport days={WEEK}>{CONTENT}</CalendarViewport>)
    const expected = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit' }).format(WEEK[0])
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })

  it('accepts a custom formatDayLabel', () => {
    mockedUseBreakpoint.mockReturnValue('sm')
    render(
      <CalendarViewport days={WEEK} formatDayLabel={(day) => `dia-${day.getUTCDate()}`}>
        {CONTENT}
      </CalendarViewport>,
    )
    expect(screen.getAllByText('dia-2').length).toBeGreaterThan(0)
  })
})
