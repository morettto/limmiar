import { describe, expect, it } from 'vitest'
import { fromWallClock, toTimeZoneId, toWallClock } from './timezone'

describe('toTimeZoneId', () => {
  it('accepts a valid IANA time zone and returns it branded', () => {
    expect(toTimeZoneId('America/Sao_Paulo')).toBe('America/Sao_Paulo')
  })

  it('throws for a string that is not a valid IANA time zone', () => {
    expect(() => toTimeZoneId('Not/A_Zone')).toThrow(Error)
  })
})

describe('toWallClock / fromWallClock', () => {
  const tz = toTimeZoneId('America/Sao_Paulo')

  it('toWallClock returns UTC fields equal to the local wall-clock time', () => {
    // 2024-06-15T12:00:00Z is 09:00 in America/Sao_Paulo (UTC-3, no DST since 2019)
    const instant = new Date('2024-06-15T12:00:00.000Z')
    const wall = toWallClock(instant, tz)
    expect(wall.getUTCHours()).toBe(9)
    expect(wall.getUTCFullYear()).toBe(2024)
    expect(wall.getUTCMonth()).toBe(5)
    expect(wall.getUTCDate()).toBe(15)
  })

  it('fromWallClock is the inverse of toWallClock outside DST gaps', () => {
    const instant = new Date('2024-06-15T12:00:00.000Z')
    const wall = toWallClock(instant, tz)
    expect(fromWallClock(wall, tz).getTime()).toBe(instant.getTime())
  })

  it('round-trips a wall-clock time back to the same instant', () => {
    const wall = new Date(Date.UTC(2024, 2, 10, 14, 30, 0, 0))
    const instant = fromWallClock(wall, tz)
    expect(toWallClock(instant, tz).getTime()).toBe(wall.getTime())
  })
})
