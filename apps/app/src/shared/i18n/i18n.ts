import { i18n } from '@lingui/core'
import { noopProfileLocaleStore, persistLocale, resolveLocale, type Locale } from '@limmiar/i18n'
import { localStorageLocaleStore } from './locale/local-storage-locale-store'
import { syncDocumentLang } from './locale/document-lang-sync'

export { i18n }

// The 2 store-backed levels of ADR-S00.5-05's order (profile, device, navigator, base). There is
// no auth/profile backend yet (S02), so profileStore is the no-op seam from packages/i18n and
// deviceStore is the real localStorage-backed store.
const localeStores = { profileStore: noopProfileLocaleStore, deviceStore: localStorageLocaleStore }

export async function initialLocale(): Promise<Locale> {
  return resolveLocale({ ...localeStores, preferences: navigator.languages })
}

export async function dynamicActivate(locale: Locale): Promise<void> {
  try {
    const { messages } = await import(`../../locales/${locale}/messages.po`)
    i18n.loadAndActivate({ locale, messages })
  } catch (error) {
    // AC: a catalog load failure (network down, 404, bad chunk — anything
    // that rejects the dynamic import) must never crash the UI and must
    // leave whichever locale was active before this call still active.
    console.error(`i18n: failed to load catalog for locale "${locale}" — keeping "${i18n.locale}" active`, error)
  }
}

// A live locale switch: persist the choice to every store first, then
// activate its catalog. Persisting before activating means a page reload
// mid-switch still boots into the locale the user just picked.
export async function setLocale(locale: Locale): Promise<void> {
  await persistLocale(locale, localeStores)
  await dynamicActivate(locale)
}

// Boot-time composition of the two halves above: resolve which locale wins
// per the 4-level order, then activate it.
export async function bootLocale(): Promise<void> {
  await dynamicActivate(await initialLocale())
}

// Keeps document.documentElement.lang in sync with i18n's active locale
// across boot, every later switch, and (by construction — see
// document-lang-sync.ts) never on a failed fallback.
syncDocumentLang(i18n)

declare global {
  interface Window {
    limmiarI18n?: {
      setLocale: typeof setLocale
      dynamicActivate: typeof dynamicActivate
    }
  }
}

// Deliberate E2E seam, not a leftover debug hook: with no locale-switcher UI yet, a browser test
// has no other way to trigger a live locale switch or a fallback. Remove in favor of driving the
// UI once a real switcher exists.
if (typeof window !== 'undefined') {
  window.limmiarI18n = { setLocale, dynamicActivate }
}
