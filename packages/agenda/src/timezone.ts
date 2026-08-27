import { TZDate } from '@date-fns/tz'

export type TimeZoneId = string & { readonly __brand: 'TimeZoneId' }

export function toTimeZoneId(value: string): TimeZoneId {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    throw new Error(`Invalid IANA time zone: ${value}`)
  }
  return value as TimeZoneId
}

// Instant → naive Date whose UTC fields equal the wall-clock time in tz.
export function toWallClock(instant: Date, tz: TimeZoneId): Date {
  const zoned = new TZDate(instant, tz)
  return new Date(
    Date.UTC(
      zoned.getFullYear(),
      zoned.getMonth(),
      zoned.getDate(),
      zoned.getHours(),
      zoned.getMinutes(),
      zoned.getSeconds(),
      zoned.getMilliseconds(),
    ),
  )
}

// Naive Date (UTC fields = wall-clock time in tz) → real absolute instant.
export function fromWallClock(wall: Date, tz: TimeZoneId): Date {
  const zoned = new TZDate(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
    tz,
  )
  return new Date(zoned.getTime())
}
