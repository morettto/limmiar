import type { Locale } from './locale'

// Single injectable read/write seam for "where a locale preference lives", one
// per level of the ADR-S00.5-05 order. Keeps this package free of `window`, so
// it still runs from Node/Astro; concrete stores live in the apps.
export interface LocaleStore {
  get(): Locale | null | Promise<Locale | null>
  set(locale: Locale): void | Promise<void>
}

// Distinct name at the call site (resolveLocale's `profileStore` param) even
// though the shape is identical to LocaleStore today — documents intent, and
// gives a future real implementation a type to target explicitly.
export type ProfileLocaleStore = LocaleStore

// `get` returning `null` forever is not a placeholder: it is the permanent,
// correct behavior for an anonymous session with no profile to consult (auth
// only starts in S02).
export const noopProfileLocaleStore: ProfileLocaleStore = {
  get: () => null,
  set: () => {},
}
