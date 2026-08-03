export type Locale = 'pt-BR' | 'es-419' | 'it-IT' | 'en-US'

export const LOCALES: readonly Locale[] = ['pt-BR', 'es-419', 'it-IT', 'en-US']

export const BASE_LOCALE: Locale = 'pt-BR'

// Guard for values arriving from an untrusted boundary (localStorage, a
// future profile backend) that claim to be a Locale but are only ever typed
// as `unknown` until proven otherwise — narrows to Locale without a cast.
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale)
}
