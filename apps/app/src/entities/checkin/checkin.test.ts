import { describe, expect, it } from 'vitest'
import { diaLocal, serieComLacunas, type CheckIn } from './checkin'

describe('diaLocal', () => {
  it('reads the local calendar day, not the UTC one, near local midnight', () => {
    // 2026-01-15T23:30 local time (fixed offset, not system-dependent): a naive
    // toISOString()-based implementation would report 2026-01-16 (UTC) instead.
    const agora = new Date(2026, 0, 15, 23, 30)

    expect(diaLocal(agora)).toBe('2026-01-15')
  })
})

function checkin(dia: string): CheckIn {
  return { dia, sono: 3, ansiedade: 3, frase: null }
}

describe('serieComLacunas', () => {
  it('fills a missing day with null instead of interpolating', () => {
    const checkins = [checkin('2026-01-14'), checkin('2026-01-16')]

    const serie = serieComLacunas(checkins, '2026-01-16', 3)

    expect(serie).toEqual([
      { dia: '2026-01-14', checkin: checkins[0] },
      { dia: '2026-01-15', checkin: null },
      { dia: '2026-01-16', checkin: checkins[1] },
    ])
  })
})
