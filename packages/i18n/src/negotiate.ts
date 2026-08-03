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

// RFC 4647 §3.4 basic filtering "lookup": try the tag as-is against the
// available locales, then progressively truncate from the last '-' and
// retry. Lookup only ever shortens the *preference* — it never matches a
// short preference (e.g. "pt") against a longer available tag ("pt-BR").
// `tag` is always already trimmed by `parseWeightedTag` before it reaches
// here, and truncation can never produce a spurious match against our fixed
// 4-entry LOCALES table (none of them are single characters or partial
// prefixes of each other), so the `.trim()` and the `length > 0` loop guard
// below are unreachable in practice given today's only call site. They stay
// as a deliberate safety net — without the length guard, a mutation (or a
// future caller) that skips the `lastDash === -1` exit would slice(0, -1) on
// an empty string forever and hang instead of terminating.
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
