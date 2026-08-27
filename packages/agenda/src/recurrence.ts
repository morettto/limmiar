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

// This is a psychologist-session agenda: no sub-daily recurrence makes
// product sense, and FREQ=SECONDLY/MINUTELY (especially from an old
// startsAt) forces the rrule engine through hundreds of millions of
// candidates before the first result, blocking the single-threaded Node
// event loop. Reject at the domain boundary, before any expansion runs.
const SUB_DAILY_FREQUENCIES = new Set([RRule.HOURLY, RRule.MINUTELY, RRule.SECONDLY])

// ~2 years — a wider window multiplies the same unbounded-cost risk even at
// allowed frequencies (e.g. FREQ=DAILY over a decade).
const MAX_WINDOW_MS = 730 * 24 * 60 * 60 * 1000

// Defense in depth under the guards above: caps how many occurrences a
// single expansion ever materializes. With the rrule field allowlist below
// (no byhour/byminute/bysecond) and the ~730-day window ceiling, no legal
// input can produce more than roughly one candidate per day any more — this
// stays as a fail-closed backstop against a change in the allowlist or the
// rrule engine's own behavior, not a ceiling reachable through normal use.
const MAX_OCCURRENCES = 10_000

// Defense in depth: `series.rrule`/`startsAt`/`exdates` used to be
// concatenated into an ICS multi-line string that rrule parsed line by
// line, so a `\r` or `\n` inside any of them could inject a synthetic
// RDATE/EXDATE/second RRULE line. Building the series through the RRule API
// below removes that vector by construction, but the guard stays as an
// explicit, tested boundary check rather than relying solely on the
// parser's (incidental) handling of embedded line breaks.
const LINE_BREAK = /[\r\n]/

function assertNoLineBreak(value: string, field: string): void {
  if (LINE_BREAK.test(value)) {
    throw new Error(`expandOccurrences: ${field} must not contain a line break (got ${JSON.stringify(value)}).`)
  }
}

const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

// 'YYYY-MM-DDTHH:mm' wall-clock string → naive Date whose UTC fields carry
// those same values (rrule's own convention: it reads a Date's UTC getters
// as "the local time", so this is how we hand it a DTSTART/EXDATE without
// rrule ever knowing about the real time zone).
function parseWallClock(value: string): Date {
  const match = WALL_CLOCK_PATTERN.exec(value)
  if (!match) {
    throw new Error(
      `expandOccurrences: expected a 'YYYY-MM-DDTHH:mm' wall-clock string, got ${JSON.stringify(value)}.`,
    )
  }
  const [, year, month, day, hour, minute] = match
  const date = new Date(`${value}:00Z`)
  // Round-trip check: `new Date(...)` silently overflows an out-of-range
  // day/month (e.g. 2024-02-30 → 2024-03-01) instead of throwing, so
  // Number.isNaN alone doesn't catch it. Re-reading the constructed date's
  // UTC fields and comparing them against the digits we parsed out of the
  // input string catches that overflow without a separate calendar parser.
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

  // Explicit allowlist, not `{ ...RRule.parseString(series.rrule), dtstart }`:
  // parseString echoes back every field it recognized in the input string,
  // including `tzid` and its own `dtstart` (only the latter was overwritten
  // by the old spread). A `TZID=...` on the same line as FREQ (no line
  // break, so the injection guard above never sees it) silently re-zoned
  // every occurrence. Naming exactly the fields this product's rrule shape
  // needs means nothing else — tzid, an embedded dtstart, byhour/byminute/
  // bysecond, wkst — ever reaches the RRule constructor. dtstart always
  // comes from `series.startsAt` via parseWallClock, never from the parsed
  // string.
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
    // A negative/zero INTERVAL makes rrule's iterator walk away from dtstart
    // and never reach its own acceptance condition — the callback below
    // never fires, so MAX_OCCURRENCES never has a chance to cut it off: an
    // unrecoverable, synchronous infinite loop. Reject before it's built.
    throw new Error(
      `expandOccurrences: rrule INTERVAL must be an integer between 1 and 366 (got ${interval}).`,
    )
  }

  // Conditional spreads, not plain keys: rrule merges the options object it
  // receives on top of its own defaults, but an explicit `key: undefined`
  // is still an *own property* — it overwrites the default (e.g. interval's
  // default of 1) with `undefined` instead of leaving it untouched. That
  // breaks the internal date-arithmetic the same way a negative INTERVAL
  // does (see above): the iterator never advances to a valid candidate and
  // spins forever. Only fields the input string actually set are included.
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

  // `<= MAX_OCCURRENCES` (not `<`) deliberately lets one candidate past the
  // ceiling through, so the length check right below can tell "exactly at
  // the ceiling" apart from "truncated" and fail closed instead of
  // returning a partial result indistinguishable from a complete one (this
  // function is also used to detect schedule overlaps).
  const naiveOccurrences = rule.between(
    fromNaive,
    untilNaive,
    true,
    (_date, acceptedSoFar) => acceptedSoFar <= MAX_OCCURRENCES,
  )
  if (naiveOccurrences.length > MAX_OCCURRENCES) {
    throw new Error('expandOccurrences: série excede o teto de ocorrências para esta janela.')
  }

  // exdates are filtered post-resolution, in the same space Occurrence.
  // localStart is reported in — not pre-expansion via RRuleSet.exdate(),
  // which compares against the naive input space. Inside a DST gap those
  // two spaces diverge (naive 00:30 vs. resolved 01:30), and an exdate
  // supplied in the input's naive format would silently fail to cancel the
  // occurrence the API actually reports.
  const excluded = new Set(
    (series.exdates ?? []).map((exdate) =>
      formatWallClock(toWallClock(fromWallClock(parseWallClock(exdate), tz), tz)),
    ),
  )

  return naiveOccurrences
    .map((naive): Occurrence => {
      const start = fromWallClock(naive, tz)
      // Re-derive from the resolved absolute instant, not the naive input:
      // when the requested wall-clock time falls in a DST spring-forward
      // gap, `start` already reflects the clock jump — localStart must match
      // (see the "DST spring-forward gap" test).
      return {
        start,
        end: new Date(start.getTime() + series.durationMinutes * 60_000),
        localStart: formatWallClock(toWallClock(start, tz)),
      }
    })
    .filter((occ) => !excluded.has(occ.localStart) && occ.start >= window.from && occ.start < window.until)
}
