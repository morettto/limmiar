import { afterEach, describe, expect, it } from 'vitest'
import { LOCALE_STORAGE_KEY, localStorageLocaleStore } from './local-storage-locale-store'

describe('localStorageLocaleStore', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('get() returns null when nothing has been persisted yet', () => {
    expect(localStorageLocaleStore.get()).toBeNull()
  })

  it('set() persists the locale under the LOCALE_STORAGE_KEY', () => {
    localStorageLocaleStore.set('it-IT')

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('it-IT')
  })

  it('get() returns a previously persisted valid locale', () => {
    localStorageLocaleStore.set('es-419')

    expect(localStorageLocaleStore.get()).toBe('es-419')
  })

  it('get() ignores a corrupted/invalid stored value and returns null', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'not-a-real-locale')

    expect(localStorageLocaleStore.get()).toBeNull()
  })
})
