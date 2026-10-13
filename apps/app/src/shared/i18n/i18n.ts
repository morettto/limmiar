import { i18n } from '@lingui/core'
import { LOCALES, noopProfileLocaleStore, persistLocale, resolveLocale, type Locale } from '@limmiar/i18n'
import { localStorageLocaleStore } from './locale/local-storage-locale-store'
import { syncDocumentLang } from './locale/document-lang-sync'

export { i18n }

// Resolution order: profile, device, pt-BR base; the browser's language is never consulted. There
// is no auth/profile backend yet (S02), so profileStore is the no-op seam from packages/i18n and
// deviceStore is the real localStorage-backed store.
const localeStores = { profileStore: noopProfileLocaleStore, deviceStore: localStorageLocaleStore }

export async function initialLocale(): Promise<Locale> {
  return resolveLocale(localeStores)
}

const loadCatalog = (locale: Locale) => import(`../../locales/${locale}/messages.po`)

export async function dynamicActivate(locale: Locale): Promise<void> {
  try {
    const { messages } = await loadCatalog(locale)
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
// (profile, device, base), then activate it.
export async function bootLocale(): Promise<void> {
  await dynamicActivate(await initialLocale())
  // Every catalog enters the module cache once the UI is up, so the first switch skips the network.
  await Promise.allSettled(LOCALES.map(loadCatalog))
}

// Keeps document.documentElement.lang in sync with i18n's active locale
// across boot, every later switch, and (by construction — see
// document-lang-sync.ts) never on a failed fallback.
syncDocumentLang(i18n)
