import { describe, expect, it } from 'vitest'
import { expandOccurrences, type RecurringSeries } from './recurrence'
import { toTimeZoneId } from './timezone'

const tz = toTimeZoneId('America/Sao_Paulo')

// Golden master: a full year of a weekly series expanded, once through a
// year with a historical DST turnover (America/Sao_Paulo dropped DST after
// 2019 — 2017 still had it) and once through a year with none (2020+). The
// snapshot pins both the wall-clock string (must stay 09:00 every week) and
// the UTC offset in minutes (must visibly shift across the 2017 turnovers,
// and stay flat through 2020).
function expandFullYear(series: RecurringSeries, year: number) {
  const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0))
  const until = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0))
  return expandOccurrences(series, { from, until }).map((occ) => ({
    localStart: occ.localStart,
    utcOffsetMinutes: (occ.start.getTime() - Date.parse(`${occ.localStart}:00Z`)) / 60_000,
  }))
}

describe('golden master — one year expanded', () => {
  it('2017 (historical DST in America/Sao_Paulo): 52-53 weekly occurrences, offset shifts across turnovers', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2017-01-05T09:00',
      timeZone: tz,
      durationMinutes: 60,
    }
    expect(expandFullYear(series, 2017)).toMatchSnapshot()
  })

  it('2020 (no DST in America/Sao_Paulo): 52-53 weekly occurrences, offset stays flat all year', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2020-01-02T09:00',
      timeZone: tz,
      durationMinutes: 60,
    }
    const occurrences = expandFullYear(series, 2020)
    expect(occurrences).toMatchSnapshot()
    expect(new Set(occurrences.map((o) => o.utcOffsetMinutes)).size).toBe(1)
  })
})
