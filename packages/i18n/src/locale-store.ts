import type { Locale } from './locale'

// A `LocaleStore` is a single, injectable read/write seam for "where does a
// locale preference live". `resolveLocale`/`persistLocale` (resolve-locale.ts)
// consult one of these per level of the ADR-S00.5-05 negotiation order — this
// package stays free of `window`/`localStorage`/any concrete backend, so it
// keeps working from Node/Astro exactly like it does today. Concrete stores
// (localStorage in apps/app, a real profile backend eventually) live in the
// apps that have the runtime to back them.
export interface LocaleStore {
  get(): Locale | null | Promise<Locale | null>
  set(locale: Locale): void | Promise<void>
}

// Distinct name at the call site (resolveLocale's `profileStore` param) even
// though the shape is identical to LocaleStore today — documents intent, and
// gives a future real implementation a type to target explicitly.
export type ProfileLocaleStore = LocaleStore

// This repo has zero auth/session/profile code anywhere yet — that only
// starts in Spec S02. `get` returning `null` forever is not a placeholder
// left to fill in later: it is the correct, permanent behavior for an
// anonymous session with no profile to consult. `resolveLocale` already
// implements the full 4-level order today; swapping this stub for a real
// profile-backed LocaleStore in S02 is a new implementation of this same
// interface, not a rewrite of the resolver.
export const noopProfileLocaleStore: ProfileLocaleStore = {
  get: () => null,
  set: () => {},
}
