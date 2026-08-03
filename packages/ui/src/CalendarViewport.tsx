import type { ReactNode } from 'react'
import { type Breakpoint, useBreakpoint } from './use-breakpoint'

// R8 — Calendário: xl → semana de 5 dias · lg → 5 dias, densidade maior ·
// md → 3 dias com rolagem horizontal · sm → 1 dia + seletor de data.
// (Wireframes - Responsivo (3 plataformas).dc.html, "Renderização por
// largura (R8)" — this is the one rule where lg tracks xl, not md/sm, so it
// needs the full 4-way Breakpoint, not a collapsed D/T/M split.)
const VISIBLE_DAYS: Record<Breakpoint, number> = {
  sm: 1,
  md: 3,
  lg: 5,
  xl: 5,
}

function defaultFormatDayLabel(day: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit' }).format(day)
}

export interface CalendarViewportProps {
  /** Full range of days available to scroll/select into (e.g. the week). */
  days: Date[]
  /** One pre-built column per day, aligned by index with `days`. */
  children: ReactNode[]
  /** Index into `days` the visible window starts/anchors from. */
  focusedDayIndex?: number
  onFocusedDayIndexChange?: (index: number) => void
  formatDayLabel?: (day: Date) => string
}

/**
 * R8 — the visible day window narrows with viewport width; below md, a date
 * selector replaces the (now single) day header so the user can still jump
 * anywhere in `days` without a multi-day grid to tap through.
 *
 * `children` takes pre-built columns (one per day) rather than a `renderDay`
 * render-prop: besides matching this project's composition convention
 * (children over render props), a function prop that returns JSX can't
 * cross Playwright Component Testing's mount() boundary — it renders a
 * permanently blank component with no error.
 */
export function CalendarViewport({
  days,
  children,
  focusedDayIndex = 0,
  onFocusedDayIndexChange,
  formatDayLabel = defaultFormatDayLabel,
}: CalendarViewportProps) {
  const breakpoint = useBreakpoint()
  const visibleCount = Math.min(VISIBLE_DAYS[breakpoint], days.length)
  const maxStart = Math.max(days.length - visibleCount, 0)
  const start = Math.min(Math.max(focusedDayIndex, 0), maxStart)
  const visibleDays = days.slice(start, start + visibleCount)
  const visibleContent = children.slice(start, start + visibleCount)

  return (
    <div className="flex flex-col gap-2">
      {breakpoint === 'sm' && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          Dia
          <select
            className="min-h-11 flex-1 rounded-md border border-neutral-300 px-2"
            value={focusedDayIndex}
            onChange={(event) => onFocusedDayIndexChange?.(Number(event.target.value))}
          >
            {days.map((day, index) => (
              <option key={day.toISOString()} value={index}>
                {formatDayLabel(day)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div role="group" aria-label="Dias" className="flex gap-2 overflow-x-auto">
        {visibleDays.map((day, index) => (
          <div key={day.toISOString()} className="min-w-0 flex-1">
            <div className="text-xs text-neutral-500">{formatDayLabel(day)}</div>
            {visibleContent[index]}
          </div>
        ))}
      </div>
    </div>
  )
}
