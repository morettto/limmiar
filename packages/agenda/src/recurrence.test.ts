import fc from 'fast-check'
import { RRule } from 'rrule'
import { describe, expect, it, vi } from 'vitest'
import { expandOccurrences, type RecurringSeries } from './recurrence'
import { toTimeZoneId } from './timezone'

const tz = toTimeZoneId('America/Sao_Paulo')

describe('expandOccurrences — trivial case (no EXDATE, no DST)', () => {
  it('expands a weekly series into one occurrence per week, keeping the wall-clock time and duration', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00', // a Thursday
      timeZone: tz,
      durationMinutes: 60,
    }
    const window = {
      from: new Date('2024-06-01T00:00:00.000Z'),
      until: new Date('2024-06-30T00:00:00.000Z'),
    }

    const occurrences = expandOccurrences(series, window)

    expect(occurrences).toHaveLength(4)
    for (const occ of occurrences) {
      expect(occ.localStart.endsWith('T14:00')).toBe(true)
      expect(occ.end.getTime() - occ.start.getTime()).toBe(60 * 60 * 1000)
    }
    expect(occurrences[0]!.localStart).toBe('2024-06-06T14:00')
  })
})

describe('expandOccurrences — EXDATE', () => {
  it('removes exactly one occurrence, the excluded one, leaving the others untouched', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
      exdates: ['2024-06-13T14:00'],
    }
    const window = {
      from: new Date('2024-06-01T00:00:00.000Z'),
      until: new Date('2024-06-30T00:00:00.000Z'),
    }

    const withExdate = expandOccurrences(series, window)
    const without = expandOccurrences({ ...series, exdates: [] }, window)

    expect(withExdate).toHaveLength(without.length - 1)
    expect(withExdate.map((o) => o.localStart)).not.toContain('2024-06-13T14:00')
  })
})

describe('expandOccurrences — EXDATE inside a DST spring-forward gap', () => {
  // Same gap as the "DST spring-forward gap" suite below: the naive input
  // 00:30 on 2017-10-15 never happened locally; the engine resolves it to
  // 01:30. The exdate is supplied in the same naive space as startsAt
  // (00:30) and must still cancel the occurrence reported as 01:30 —
  // filtering happens post-resolution, in the space Occurrence.localStart
  // actually lives in, not the pre-resolution naive space.
  it('cancels the occurrence whose resolved localStart (01:30) lands after the gap, using the naive (never-happened) exdate input (00:30)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startsAt: '2017-10-15T00:30',
      timeZone: tz,
      durationMinutes: 60,
      exdates: ['2017-10-15T00:30'],
    }
    const window = {
      from: new Date('2017-10-14T00:00:00.000Z'),
      until: new Date('2017-10-30T00:00:00.000Z'), // covers this Sunday and the next
    }

    const withExdate = expandOccurrences(series, window)
    const without = expandOccurrences({ ...series, exdates: [] }, window)

    expect(withExdate).toHaveLength(without.length - 1)
    expect(withExdate.map((o) => o.localStart)).not.toContain('2017-10-15T01:30')
  })
})

describe('expandOccurrences — crossing a DST turnover', () => {
  // America/Sao_Paulo ended DST on 2019-02-17 (last historical turnover) —
  // 2018-02-17T23:59 -02:00 (DST) rolled back to 2018-02-17T23:00 -03:00.
  it('keeps 14:00 local across the fall-back turnover, while the UTC instant shifts by 1 hour', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2018-02-08T14:00', // Thursday before the 2018-02-17/18 (Sat) turnover
      timeZone: tz,
      durationMinutes: 60,
    }
    const window = {
      from: new Date('2018-02-01T00:00:00.000Z'),
      until: new Date('2018-03-01T00:00:00.000Z'),
    }

    const occurrences = expandOccurrences(series, window)

    expect(occurrences.every((o) => o.localStart.endsWith('T14:00'))).toBe(true)

    const before = occurrences.find((o) => o.localStart === '2018-02-08T14:00')!
    const after = occurrences.find((o) => o.localStart === '2018-02-22T14:00')!
    // -02:00 (DST) before the turnover, -03:00 after: the UTC hour advances by one.
    expect(before.start.getUTCHours()).toBe(16)
    expect(after.start.getUTCHours()).toBe(17)
  })
})

describe('expandOccurrences — unbounded expansion guard', () => {
  it('throws a domain error, synchronously and fast, for FREQ=SECONDLY instead of expanding', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=SECONDLY',
      startsAt: '1970-01-01T00:00',
      timeZone: tz,
      durationMinutes: 30,
    }
    const window = {
      from: new Date('2024-01-01T00:00:00.000Z'),
      until: new Date('2024-01-02T00:00:00.000Z'),
    }

    expect(() => expandOccurrences(series, window)).toThrow(/frequ/i)
  })

  it('throws a domain error for FREQ=MINUTELY', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=MINUTELY',
      startsAt: '1970-01-01T00:00',
      timeZone: tz,
      durationMinutes: 30,
    }
    const window = {
      from: new Date('2024-01-01T00:00:00.000Z'),
      until: new Date('2024-01-02T00:00:00.000Z'),
    }

    expect(() => expandOccurrences(series, window)).toThrow(/frequ/i)
  })

  it('throws a domain error for FREQ=HOURLY (sub-daily recurrence has no place in a psychologist session agenda)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=HOURLY',
      startsAt: '2024-01-01T00:00',
      timeZone: tz,
      durationMinutes: 30,
    }
    const window = {
      from: new Date('2024-01-01T00:00:00.000Z'),
      until: new Date('2024-01-02T00:00:00.000Z'),
    }

    expect(() => expandOccurrences(series, window)).toThrow(/frequ/i)
  })

  it('throws a domain error when the window spans more than ~2 years', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }
    const window = {
      from: new Date('2020-01-01T00:00:00.000Z'),
      until: new Date('2024-01-01T00:00:00.000Z'),
    }

    expect(() => expandOccurrences(series, window)).toThrow(/window|janela/i)
  })

  it(
    'throws a domain error for INTERVAL=-1, synchronously and fast — regression guard for the ' +
      'negative-interval infinite loop (the rrule iterator walks backward from dtstart and never ' +
      'reaches the acceptance condition, so it never calls back and MAX_OCCURRENCES never fires)',
    () => {
      const series: RecurringSeries = {
        rrule: 'FREQ=DAILY;INTERVAL=-1',
        startsAt: '2024-01-01T00:00',
        timeZone: tz,
        durationMinutes: 30,
      }
      const window = {
        from: new Date('2024-01-01T00:00:00.000Z'),
        until: new Date('2024-01-02T00:00:00.000Z'),
      }

      expect(() => expandOccurrences(series, window)).toThrow(/interval/i)
    },
    2000,
  )

  it('ignores BYHOUR/BYMINUTE/BYSECOND on the rrule — a dense grid produces the exact same result as the bare FREQ=DAILY rule, because these fields are deliberately outside the allowlist passed to RRule', () => {
    const dense: RecurringSeries = {
      rrule:
        'FREQ=DAILY;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23;BYMINUTE=0,15,30,45;BYSECOND=0,30',
      startsAt: '2024-01-01T00:00',
      timeZone: tz,
      durationMinutes: 15,
    }
    const bare: RecurringSeries = { ...dense, rrule: 'FREQ=DAILY' }
    const window = {
      from: new Date('2024-01-01T00:00:00.000Z'),
      until: new Date('2024-02-01T00:00:00.000Z'),
    }

    expect(expandOccurrences(dense, window)).toEqual(expandOccurrences(bare, window))
  })

  // The occurrence ceiling (documented as MAX_OCCURRENCES in recurrence.ts) was the "safety net"
  // for dense BYHOUR/BYMINUTE grids under the old spread-everything-into-RRule construction. Now
  // that BYHOUR/BYMINUTE/BYSECOND are outside the allowlist (see the test above) and the window is
  // capped at ~730 days, the allowed rrule shapes (freq/interval/count/until/byweekday/bymonth/
  // bymonthday/bysetpos) can never produce more than one candidate per day — so no legal input
  // reaches 10 000 candidates any more. The ceiling is genuinely defense-in-depth now: still worth
  // failing closed on, but only reachable if the rrule engine's own behavior changes. We prove the
  // fail-closed behavior directly by substituting the engine's output, rather than by contorting a
  // legal rrule string (impossible with this allowlist) or temporarily lowering the constant
  // (see task guidance — not a good practice for this kind of assertion).
  it('throws (fails closed) instead of silently truncating, when the recurrence engine returns more naive occurrences than the ceiling', () => {
    const spy = vi.spyOn(RRule.prototype, 'between').mockReturnValue(
      Array.from({ length: 10_001 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i))),
    )
    try {
      const series: RecurringSeries = {
        rrule: 'FREQ=DAILY',
        startsAt: '2024-01-01T00:00',
        timeZone: tz,
        durationMinutes: 15,
      }
      const window = {
        from: new Date('2024-01-01T00:00:00.000Z'),
        until: new Date('2024-02-01T00:00:00.000Z'),
      }

      expect(() => expandOccurrences(series, window)).toThrow(/ceiling|teto/i)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('expandOccurrences — allowlisted rrule fields take effect', () => {
  // Coverage for each field the allowlist actually passes through to RRule
  // when the input string sets it (the "defined" branch of each conditional
  // spread in recurrence.ts) — not just that they're not silently dropped,
  // but that each one changes the expansion the way RFC5545 says it should.
  const window = {
    from: new Date('2024-01-01T00:00:00.000Z'),
    until: new Date('2024-07-01T00:00:00.000Z'),
  }

  it('honors a valid INTERVAL greater than 1 (every 2 weeks, not every week)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(expandOccurrences(series, window).map((o) => o.localStart)).toEqual([
      '2024-06-06T14:00',
      '2024-06-20T14:00',
    ])
  })

  it('honors COUNT, stopping the series after the given number of occurrences even though the window would allow more', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=2',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(expandOccurrences(series, window).map((o) => o.localStart)).toEqual([
      '2024-06-06T14:00',
      '2024-06-13T14:00',
    ])
  })

  it('honors UNTIL, stopping the series at the given date even though the window would allow more', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20240613T140000Z',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(expandOccurrences(series, window).map((o) => o.localStart)).toEqual([
      '2024-06-06T14:00',
      '2024-06-13T14:00',
    ])
  })

  it('honors BYMONTH and BYMONTHDAY (a yearly rule pinned to a specific month/day)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=15',
      startsAt: '2024-01-01T09:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(expandOccurrences(series, window).map((o) => o.localStart)).toEqual(['2024-06-15T09:00'])
  })

  it('honors BYSETPOS (the first Monday of each month)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1',
      startsAt: '2024-01-01T09:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(expandOccurrences(series, window).map((o) => o.localStart)).toEqual([
      '2024-01-01T09:00',
      '2024-02-05T09:00',
      '2024-03-04T09:00',
      '2024-04-01T09:00',
      '2024-05-06T09:00',
      '2024-06-03T09:00',
    ])
  })
})

describe('expandOccurrences — malformed FREQ', () => {
  const window = {
    from: new Date('2024-01-01T00:00:00.000Z'),
    until: new Date('2024-12-31T00:00:00.000Z'),
  }

  it.each([['empty string', ''], ['whitespace only', '   '], ['no FREQ token', 'BYDAY=TH']])(
    'throws a domain error instead of silently defaulting to YEARLY, when series.rrule is %s',
    (_label, rrule) => {
      const series: RecurringSeries = {
        rrule,
        startsAt: '2024-01-01T00:00',
        timeZone: tz,
        durationMinutes: 30,
      }

      expect(() => expandOccurrences(series, window)).toThrow(/FREQ/i)
    },
  )
})

describe('expandOccurrences — TZID/DTSTART embedded in the rrule string', () => {
  it('produces identical occurrences with and without an embedded TZID/DTSTART on the same line (no line break, so the line-injection guard cannot see it) — only startsAt/timeZone ever drive dtstart/tz', () => {
    const window = {
      from: new Date('2024-06-01T00:00:00.000Z'),
      until: new Date('2024-06-30T00:00:00.000Z'),
    }
    const plain: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }
    const withEmbeddedTzid: RecurringSeries = {
      ...plain,
      rrule: 'FREQ=WEEKLY;BYDAY=TH;DTSTART;TZID=Asia/Tokyo:19990101T000000',
    }

    expect(expandOccurrences(withEmbeddedTzid, window)).toEqual(expandOccurrences(plain, window))
  })
})

describe('expandOccurrences — wall-clock string validation', () => {
  const window = {
    from: new Date('2024-01-01T00:00:00.000Z'),
    until: new Date('2024-12-31T00:00:00.000Z'),
  }

  it('rejects a startsAt that does not match the YYYY-MM-DDTHH:mm shape', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06 14:00', // space instead of T
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/wall-clock/i)
  })

  it('rejects a startsAt that matches the shape but is not a real calendar date/time', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-13-99T99:99', // passes the shape regex, fails as a real date
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/invalid wall-clock/i)
  })

  it('rejects a startsAt whose day overflows the month (2024-02-30 does not exist) instead of silently rolling over to 2024-03-01/02', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-02-30T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/invalid wall-clock/i)
  })

  it('rejects a startsAt whose day overflows a 30-day month (2024-04-31 does not exist)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-04-31T10:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/invalid wall-clock/i)
  })

  it('rejects an overflowing day in an exdate entry too, not just startsAt', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
      exdates: ['2024-02-30T14:00'],
    }

    expect(() => expandOccurrences(series, window)).toThrow(/invalid wall-clock/i)
  })
})

describe('expandOccurrences — iCal line-injection guard', () => {
  const window = {
    from: new Date('2024-01-01T00:00:00.000Z'),
    until: new Date('2024-12-31T00:00:00.000Z'),
  }

  it('rejects a newline in series.rrule instead of silently accepting an injected RDATE line', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY\nRDATE:20990101T000000Z',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/rrule/i)
  })

  it('rejects a carriage return in series.rrule', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY\rRDATE:20990101T000000Z',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/rrule/i)
  })

  it('rejects a newline in series.startsAt', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00\nRDATE:20990101T000000Z',
      timeZone: tz,
      durationMinutes: 60,
    }

    expect(() => expandOccurrences(series, window)).toThrow(/startsAt/i)
  })

  it('rejects a newline inside a series.exdates entry', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
      exdates: ['2024-06-13T14:00\nRDATE:20990101T000000Z'],
    }

    expect(() => expandOccurrences(series, window)).toThrow(/exdates/i)
  })
})

describe('expandOccurrences — DST spring-forward gap', () => {
  // America/Sao_Paulo entered DST at 2017-10-15T00:00 local, jumping straight
  // to 01:00 — the wall-clock half hour 00:00–00:59 never happened that day.
  it('reports the localStart the clock actually landed on (01:30), not the naive wall-clock time that never existed (00:30)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      startsAt: '2017-10-15T00:30', // falls inside the spring-forward gap
      timeZone: tz,
      durationMinutes: 60,
    }
    const window = {
      from: new Date('2017-10-14T00:00:00.000Z'),
      until: new Date('2017-10-16T00:00:00.000Z'),
    }

    const occurrences = expandOccurrences(series, window)

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]!.localStart).toBe('2017-10-15T01:30')
    expect(occurrences[0]!.start.toISOString()).toBe('2017-10-15T03:30:00.000Z')
  })
})

describe('expandOccurrences — window boundary', () => {
  it('excludes an occurrence exactly at window.until (semi-open) and includes one exactly at window.from', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      startsAt: '2024-06-06T14:00',
      timeZone: tz,
      durationMinutes: 60,
    }
    // 2024-06-06T14:00 America/Sao_Paulo (-03:00) === 2024-06-06T17:00Z
    const from = new Date('2024-06-06T17:00:00.000Z')
    const until = new Date('2024-06-13T17:00:00.000Z')

    const occurrences = expandOccurrences(series, { from, until })

    expect(occurrences.map((o) => o.localStart)).toEqual(['2024-06-06T14:00'])
  })

  it('never returns an occurrence whose start falls outside [from, until)', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=DAILY',
      startsAt: '2024-06-01T23:30',
      timeZone: tz,
      durationMinutes: 30,
    }
    const from = new Date('2024-06-05T00:00:00.000Z')
    const until = new Date('2024-06-10T02:29:00.000Z')

    const occurrences = expandOccurrences(series, { from, until })

    expect(occurrences.length).toBeGreaterThan(0)
    for (const occ of occurrences) {
      expect(occ.start >= from).toBe(true)
      expect(occ.start < until).toBe(true)
    }
  })
})

describe('expandOccurrences — property: never outside [from, until)', () => {
  it('holds for random windows, including ones straddling a DST turnover', () => {
    const series: RecurringSeries = {
      rrule: 'FREQ=DAILY',
      startsAt: '2017-06-01T14:00',
      timeZone: tz,
      durationMinutes: 45,
    }
    const epoch2017 = Date.UTC(2017, 0, 1)
    const epoch2019 = Date.UTC(2019, 0, 1)

    fc.assert(
      fc.property(
        fc.integer({ min: epoch2017, max: epoch2019 }),
        fc.integer({ min: 0, max: 60 * 24 * 60 * 60 * 1000 }),
        (fromMs, spanMs) => {
          const from = new Date(fromMs)
          const until = new Date(fromMs + spanMs)
          const occurrences = expandOccurrences(series, { from, until })
          return occurrences.every((o) => o.start >= from && o.start < until)
        },
      ),
    )
  })
})
