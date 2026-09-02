import { afterEach, describe, expect, it, vi } from 'vitest'
import { negotiateLocale } from '@limmiar/i18n'
import { LOCALE_STORAGE_KEY } from './locale/local-storage-locale-store'
import { bootLocale, dynamicActivate, i18n, initialLocale, setLocale } from './i18n'

describe('initialLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('negotiates the initial locale from navigator.languages via RFC 4647 lookup when nothing is persisted', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['it-IT', 'en-US'])

    await expect(initialLocale()).resolves.toBe(negotiateLocale(window.navigator.languages))
    await expect(initialLocale()).resolves.toBe('it-IT')
  })

  it('falls back to the base locale when the browser has no matching preference and nothing is persisted', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'de-DE'])

    await expect(initialLocale()).resolves.toBe('pt-BR')
  })

  it('a persisted localStorage locale wins over navigator.languages (ADR-S00.5-05 order: device beats navigator)', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['en-US'])
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'it-IT')

    await expect(initialLocale()).resolves.toBe('it-IT')
  })

  it('ignores a corrupted/invalid localStorage value and falls through to navigator.languages', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-419'])
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'not-a-real-locale')

    await expect(initialLocale()).resolves.toBe('es-419')
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

    // No catalog exists for this made-up locale, so the dynamic import genuinely rejects — a
    // real stand-in for "the catalog failed to load" (a 404 or a chunk error surfaces the same
    // way: a rejected import()).
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

describe('setLocale', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('persists the locale to localStorage and activates its catalog', async () => {
    await setLocale('it-IT')

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('it-IT')
    expect(i18n.locale).toBe('it-IT')
  })
})

describe('bootLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('resolves the initial locale (per the 4-level order) and activates it in one call', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-419'])

    await bootLocale()

    expect(i18n.locale).toBe('es-419')
  })
})

describe('window.limmiarI18n — deliberate E2E test seam', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('exposes setLocale and dynamicActivate on window when a window exists (real browser/jsdom)', () => {
    // The module-scope assignment already ran when this file's static import pulled in ./i18n
    // under the normal jsdom `window`, so asserting against those same exported references
    // confirms it took the truthy branch of the window guard.
    expect(window.limmiarI18n).toEqual({ setLocale, dynamicActivate })
  })

  it('skips the assignment without throwing when window is undefined (defensive non-DOM guard)', async () => {
    // Re-imported fresh (vi.resetModules + dynamic import) so the module-top-level guard
    // re-executes with `window` stubbed out, instead of only ever running once at file-load time
    // under the real jsdom window.
    vi.resetModules()
    vi.stubGlobal('window', undefined)

    await expect(import('./i18n')).resolves.toBeDefined()
  })
})
