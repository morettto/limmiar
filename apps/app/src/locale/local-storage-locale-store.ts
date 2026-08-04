import { isLocale, type LocaleStore } from '@limmiar/i18n'

// Level 2 of ADR-S00.5-05's negotiation order ("device"). This concrete
// localStorage-backed implementation lives here (not in packages/i18n)
// because only apps/app has a DOM/window runtime to back it — packages/i18n
// stays importable from Node/Astro, where `window` doesn't exist.
export const LOCALE_STORAGE_KEY = 'limmiar:locale'

export const localStorageLocaleStore: LocaleStore = {
  get() {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(raw) ? raw : null
  },
  set(locale) {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  },
}
