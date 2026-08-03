import { afterEach, describe, expect, it, vi } from 'vitest'
import { negotiateLocale } from '@limmiar/i18n'
import { i18n, initialLocale, dynamicActivate } from './i18n'

describe('initialLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('negotiates the initial locale from navigator.languages via RFC 4647 lookup', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['it-IT', 'en-US'])

    expect(initialLocale()).toBe(negotiateLocale(window.navigator.languages))
    expect(initialLocale()).toBe('it-IT')
  })

  it('falls back to the base locale when the browser has no matching preference', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'de-DE'])

    expect(initialLocale()).toBe('pt-BR')
  })
})

describe('dynamicActivate — catalog load failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never throws and keeps the previously active locale when the catalog fails to load', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await dynamicActivate('pt-BR')
    expect(i18n.locale).toBe('pt-BR')

    // No catalog exists for this made-up locale, so the dynamic import
    // genuinely rejects (module not found) — a real, not mocked, stand-in
    // for "the catalog failed to load" (network 404, chunk load error,
    // etc. all surface the same way: a rejected import()).
    await expect(dynamicActivate('xx-XX' as never)).resolves.toBeUndefined()

    expect(i18n.locale).toBe('pt-BR')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('xx-XX'), expect.anything())
  })
})

describe('dynamicActivate — happy path', () => {
  it('loads and activates the real compiled catalog for a locale', async () => {
    await dynamicActivate('en-US')

    expect(i18n.locale).toBe('en-US')
  })
})
