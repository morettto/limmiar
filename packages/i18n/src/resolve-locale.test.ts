import { describe, expect, it } from 'vitest'
import type { Locale } from './locale'
import type { LocaleStore } from './locale-store'
import { persistLocale, resolveLocale } from './resolve-locale'

// Minimal in-memory fake — not a mock. Exercises resolveLocale/persistLocale
// exactly the way a real store (localStorage-backed, profile-backed) would:
// through the LocaleStore interface only.
function fakeStore(initial: unknown = null): LocaleStore & { value: unknown } {
  return {
    value: initial,
    get() {
      return this.value as Locale | null
    },
    set(locale) {
      this.value = locale
    },
  }
}

describe('resolveLocale', () => {
  it('profile store wins over everything else when it holds a valid locale', async () => {
    const profileStore = fakeStore('it-IT')
    const deviceStore = fakeStore('en-US')

    const result = await resolveLocale({ profileStore, deviceStore, preferences: 'es-419' })

    expect(result).toBe('it-IT')
  })

  it('device store wins over navigator preferences when profile has nothing', async () => {
    const profileStore = fakeStore(null)
    const deviceStore = fakeStore('en-US')

    const result = await resolveLocale({ profileStore, deviceStore, preferences: 'it-IT' })

    expect(result).toBe('en-US')
  })

  it('falls through to negotiateLocale(preferences) when both stores are empty', async () => {
    const profileStore = fakeStore(null)
    const deviceStore = fakeStore(null)

    const result = await resolveLocale({ profileStore, deviceStore, preferences: 'it-IT' })

    expect(result).toBe('it-IT')
  })

  it('falls through to base locale when both stores are empty and preferences match nothing', async () => {
    const profileStore = fakeStore(null)
    const deviceStore = fakeStore(null)

    const result = await resolveLocale({ profileStore, deviceStore, preferences: null })

    expect(result).toBe('pt-BR')
  })

  it('ignores an invalid/corrupted value in the profile store and falls through to the device store', async () => {
    const profileStore = fakeStore('not-a-real-locale')
    const deviceStore = fakeStore('it-IT')

    const result = await resolveLocale({ profileStore, deviceStore, preferences: 'en-US' })

    expect(result).toBe('it-IT')
  })

  it('ignores an invalid/corrupted value in the device store and falls through to negotiateLocale', async () => {
    const profileStore = fakeStore(null)
    const deviceStore = fakeStore('{corrupted}')

    const result = await resolveLocale({ profileStore, deviceStore, preferences: 'en-US' })

    expect(result).toBe('en-US')
  })

  it('supports stores whose get() is itself async (a real profile backend, e.g. an HTTP-backed store)', async () => {
    const profileStore: LocaleStore = {
      get: () => Promise.resolve('en-US'),
      set: () => {},
    }
    const deviceStore = fakeStore('it-IT')

    const result = await resolveLocale({ profileStore, deviceStore, preferences: null })

    expect(result).toBe('en-US')
  })
})

describe('persistLocale', () => {
  it('writes the locale to both the device store and the profile store', async () => {
    const profileStore = fakeStore(null)
    const deviceStore = fakeStore(null)

    await persistLocale('es-419', { profileStore, deviceStore })

    expect(profileStore.value).toBe('es-419')
    expect(deviceStore.value).toBe('es-419')
  })

  it('writes to both stores in parallel (awaits both set() calls even if async)', async () => {
    const calls: string[] = []
    const profileStore: LocaleStore = {
      get: () => null,
      set: async (locale) => {
        await Promise.resolve()
        calls.push(`profile:${locale}`)
      },
    }
    const deviceStore: LocaleStore = {
      get: () => null,
      set: async (locale) => {
        calls.push(`device:${locale}`)
      },
    }

    await persistLocale('en-US', { profileStore, deviceStore })

    expect(calls.sort()).toEqual(['device:en-US', 'profile:en-US'])
  })
})
