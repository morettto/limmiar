import type { Locale } from './locale'

function createMemoizedFactory<TFormat, TOptions extends object>(
  Ctor: new (locale: Locale, options?: TOptions) => TFormat,
): (locale: Locale, options?: TOptions) => TFormat {
  const cache = new Map<string, TFormat>()
  return (locale, options) => {
    // Cache key is a plain JSON.stringify: two call sites building the same
    // options in a different key order miss the cache and build a duplicate
    // (still correct) formatter — accepted to keep this a pure function.
    const key = `${locale}::${JSON.stringify(options ?? {})}`
    const cached = cache.get(key)
    if (cached) return cached
    const created = new Ctor(locale, options)
    cache.set(key, created)
    return created
  }
}

export const getNumberFormat = createMemoizedFactory<Intl.NumberFormat, Intl.NumberFormatOptions>(
  Intl.NumberFormat,
)

export const getDateTimeFormat = createMemoizedFactory<Intl.DateTimeFormat, Intl.DateTimeFormatOptions>(
  Intl.DateTimeFormat,
)

export const getRelativeTimeFormat = createMemoizedFactory<
  Intl.RelativeTimeFormat,
  Intl.RelativeTimeFormatOptions
>(Intl.RelativeTimeFormat)

export const getListFormat = createMemoizedFactory<Intl.ListFormat, Intl.ListFormatOptions>(Intl.ListFormat)

export const getPluralRules = createMemoizedFactory<Intl.PluralRules, Intl.PluralRulesOptions>(
  Intl.PluralRules,
)
