import { describe, expect, it } from 'vitest'
import { LOCALES } from '@limmiar/i18n'
import { content } from './content'

describe('content', () => {
  it('has exactly one entry per configured locale (nothing missing, nothing extra)', () => {
    expect(Object.keys(content).sort()).toEqual([...LOCALES].sort())
  })

  it.each(LOCALES)('has a non-empty title and body for locale %s', (locale) => {
    const entry = content[locale]

    expect(entry.title.length).toBeGreaterThan(0)
    expect(entry.body.length).toBeGreaterThan(0)
  })
})
