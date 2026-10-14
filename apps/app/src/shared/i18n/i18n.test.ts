import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALE_STORAGE_KEY } from './locale/local-storage-locale-store'
import { bootLocale, dynamicActivate, i18n, initialLocale, setLocale } from './i18n'

describe('initialLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('opens in pt-BR whatever the browser languages say when nothing is persisted', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['it-IT', 'en-US'])

    await expect(initialLocale()).resolves.toBe('pt-BR')
  })

  it('a persisted localStorage locale wins over the base locale', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'it-IT')

    await expect(initialLocale()).resolves.toBe('it-IT')
  })

  it('ignores a corrupted/invalid localStorage value and falls back to pt-BR', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-419'])
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'not-a-real-locale')

    await expect(initialLocale()).resolves.toBe('pt-BR')
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

  it('activates pt-BR even when the browser prefers another supported language', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['en-US'])
    await dynamicActivate('es-419')

    await bootLocale()

    expect(i18n.locale).toBe('pt-BR')
  })

  it('activates the persisted locale on boot', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es-419')

    await bootLocale()

    expect(i18n.locale).toBe('es-419')
  })
})
