import { RRule } from 'rrule'
import { fromWallClock, toTimeZoneId, toWallClock, type TimeZoneId } from './timezone'

export interface RecurringSeries {
  rrule: string
  startsAt: string
  timeZone: TimeZoneId
  durationMinutes: number
  exdates?: readonly string[]
}

export interface Occurrence {
  start: Date
  end: Date
  localStart: string
}

export interface Window {
  from: Date
  until: Date
}

const SLACK_MS = 24 * 60 * 60 * 1000

// Sub-daily recurrence makes no sense for a session agenda, and SECONDLY/
// MINUTELY from an old startsAt walks hundreds of millions of candidates on
// the single-threaded event loop. Reject at the domain boundary.
const SUB_DAILY_FREQUENCIES = new Set([RRule.HOURLY, RRule.MINUTELY, RRule.SECONDLY])

// ~2 years — a wider window multiplies the same unbounded-cost risk even at
// allowed frequencies (e.g. FREQ=DAILY over a decade).
const MAX_WINDOW_MS = 730 * 24 * 60 * 60 * 1000

// Fail-closed backstop, not a ceiling reachable through normal use: with the
// field allowlist below and the ~730-day window, no legal input produces more
// than roughly one candidate per day.
const MAX_OCCURRENCES = 10_000

// The series used to be built as an ICS string, where a CR or LF inside any
// field injected an extra RDATE/EXDATE/RRULE line. The RRule API below removes
// that vector; this stays as an explicit, tested boundary check.
const LINE_BREAK = /[\r\n]/

function assertNoLineBreak(value: string, field: string): void {
  if (LINE_BREAK.test(value)) {
    throw new Error(`expandOccurrences: ${field} must not contain a line break (got ${JSON.stringify(value)}).`)
  }
}

const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

// 'YYYY-MM-DDTHH:mm' to a naive Date whose UTC fields carry those same values:
// rrule reads a Date's UTC getters as "the local time", so this is how DTSTART
// and EXDATE are handed over without rrule knowing the real time zone.
function parseWallClock(value: string): Date {
  const match = WALL_CLOCK_PATTERN.exec(value)
  if (!match) {
    throw new Error(
      `expandOccurrences: expected a 'YYYY-MM-DDTHH:mm' wall-clock string, got ${JSON.stringify(value)}.`,
    )
  }
  const [, year, month, day, hour, minute] = match
  const date = new Date(`${value}:00Z`)
  // `new Date(...)` overflows an out-of-range day (2024-02-30 to 2024-03-01)
  // instead of throwing, so Number.isNaN misses it: re-read the constructed
  // date's UTC fields and compare them against the parsed digits.
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute)
  ) {
    throw new Error(`expandOccurrences: invalid wall-clock date/time: ${JSON.stringify(value)}.`)
  }
  return date
}

// Naive Date (UTC fields = wall-clock) → 'YYYY-MM-DDTHH:mm'.
function formatWallClock(naive: Date): string {
  return naive.toISOString().slice(0, 16)
}

export function expandOccurrences(series: RecurringSeries, window: Window): Occurrence[] {
  const tz = toTimeZoneId(series.timeZone)

  assertNoLineBreak(series.rrule, 'series.rrule')
  assertNoLineBreak(series.startsAt, 'series.startsAt')
  for (const exdate of series.exdates ?? []) {
    assertNoLineBreak(exdate, 'series.exdates')
  }

  if (window.until.getTime() - window.from.getTime() > MAX_WINDOW_MS) {
    throw new Error(
      'expandOccurrences: window is wider than the ~730-day (2 year) ceiling.',
    )
  }

  // Explicit allowlist, not a spread of parseString's output: a `TZID=` on the
  // FREQ line (no line break, so the injection guard misses it) silently
  // re-zoned every occurrence. dtstart always comes from parseWallClock.
  const { freq, interval, count, until, byweekday, bymonth, bymonthday, bysetpos } = RRule.parseString(
    series.rrule,
  )

  if (freq === undefined) {
    throw new Error(
      `expandOccurrences: FREQ ausente ou rrule vazia/inválida (rrule: ${JSON.stringify(series.rrule)}).`,
    )
  }
  if (SUB_DAILY_FREQUENCIES.has(freq)) {
    throw new Error(
      `expandOccurrences: sub-daily recurrence frequency is not supported (got "${series.rrule}").`,
    )
  }
  if (interval !== undefined && (!Number.isInteger(interval) || interval < 1 || interval > 366)) {
    // A negative or zero INTERVAL makes rrule's iterator walk away from dtstart
    // forever: the callback below never fires, so MAX_OCCURRENCES never gets to
    // cut it off. Reject before the rule is built.
    throw new Error(
      `expandOccurrences: rrule INTERVAL must be an integer between 1 and 366 (got ${interval}).`,
    )
  }

  // Conditional spreads: an explicit `key: undefined` is still an own property
  // and overwrites rrule's default (interval 1), which spins the iterator the
  // same way a negative INTERVAL does.
  const rule = new RRule({
    freq,
    ...(interval !== undefined && { interval }),
    ...(count !== undefined && { count }),
    ...(until !== undefined && { until }),
    ...(byweekday !== undefined && { byweekday }),
    ...(bymonth !== undefined && { bymonth }),
    ...(bymonthday !== undefined && { bymonthday }),
    ...(bysetpos !== undefined && { bysetpos }),
    dtstart: parseWallClock(series.startsAt),
  })

  const fromNaive = new Date(toWallClock(window.from, tz).getTime() - SLACK_MS)
  const untilNaive = new Date(toWallClock(window.until, tz).getTime() + SLACK_MS)

  // `<= MAX_OCCURRENCES` lets one candidate past the ceiling so the length
  // check below can tell "exactly at the ceiling" from "truncated" and fail
  // closed instead of returning a partial result.
  const naiveOccurrences = rule.between(
    fromNaive,
    untilNaive,
    true,
    (_date, acceptedSoFar) => acceptedSoFar <= MAX_OCCURRENCES,
  )
  if (naiveOccurrences.length > MAX_OCCURRENCES) {
    throw new Error('expandOccurrences: série excede o teto de ocorrências para esta janela.')
  }

  // exdates are filtered post-resolution, in the space Occurrence.localStart is
  // reported in: inside a DST gap the naive input (00:30) and the resolved
  // value (01:30) diverge, and a pre-expansion exdate would fail to cancel.
  const excluded = new Set(
    (series.exdates ?? []).map((exdate) =>
      formatWallClock(toWallClock(fromWallClock(parseWallClock(exdate), tz), tz)),
    ),
  )

  return naiveOccurrences
    .map((naive): Occurrence => {
      const start = fromWallClock(naive, tz)
      // Re-derive from the resolved absolute instant: in a DST spring-forward
      // gap `start` already reflects the clock jump, and localStart must match.
      return {
        start,
        end: new Date(start.getTime() + series.durationMinutes * 60_000),
        localStart: formatWallClock(toWallClock(start, tz)),
      }
    })
    .filter((occ) => !excluded.has(occ.localStart) && occ.start >= window.from && occ.start < window.until)
}
