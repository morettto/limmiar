import { BASE_LOCALE, LOCALES, type Locale } from './locale'

interface WeightedTag {
  tag: string
  q: number
}

function parseWeightedTag(entry: string): WeightedTag {
  const [tagPart, ...params] = entry.split(';').map((part) => part.trim())
  const qParam = params.find((param) => param.startsWith('q='))
  const parsedQ = qParam ? Number.parseFloat(qParam.slice(2)) : 1
  return { tag: tagPart, q: Number.isFinite(parsedQ) ? parsedQ : 1 }
}

// RFC 4647 §3.4 lookup: try the tag, then truncate from the last '-' and retry;
// it only shortens the preference, never matching "pt" against "pt-BR". The
// `length > 0` guard keeps a mutation from slicing an empty string forever.
function lookupSingle(tag: string): Locale | undefined {
  let candidate = tag.trim().toLowerCase()
  while (candidate.length > 0) {
    const match = LOCALES.find((locale) => locale.toLowerCase() === candidate)
    if (match) return match
    const lastDash = candidate.lastIndexOf('-')
    if (lastDash === -1) return undefined
    candidate = candidate.slice(0, lastDash)
  }
  return undefined
}

export function negotiateLocale(preferences: string | readonly string[] | null | undefined): Locale {
  if (preferences == null) return BASE_LOCALE

  const entries = typeof preferences === 'string' ? preferences.split(',') : preferences

  const weighted = entries
    .map(parseWeightedTag)
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    // Stable sort: Array#sort has been spec-guaranteed stable since ES2019,
    // well within this project's Node/V8 baseline, so equal-q entries keep
    // the caller's original preference order without an explicit tie-breaker.
    .sort((a, b) => b.q - a.q)

  for (const { tag } of weighted) {
    const match = lookupSingle(tag)
    if (match) return match
  }

  return BASE_LOCALE
}
