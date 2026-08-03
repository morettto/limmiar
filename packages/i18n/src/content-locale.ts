import type { Locale } from './locale'

// Branded/opaque: a ContentLocale is only ever produced by toContentLocale, never
// assignable from a bare Locale/string. S01's encrypted flow and S03/S05's
// Patient/Session entities don't exist in this repo yet, so there is no runtime
// boundary to enforce D20 ("contentLocale nunca sai em claro fora do fluxo
// cifrado") against today. The brand is the guardrail available now: it stops the
// UI's interface locale (D17, plain Locale) from being silently reused as a
// session's content locale at the type level, ahead of the real encrypted path.
declare const contentLocaleBrand: unique symbol

export type ContentLocale = Locale & { readonly [contentLocaleBrand]: true }

export function toContentLocale(locale: Locale): ContentLocale {
  return locale as ContentLocale
}

/**
 * Port S05 implements to map a session's contentLocale (D17) to the Nemotron ASR
 * `target_lang` parameter. This ticket (S00.5-07) only defines the seam — consuming
 * it to drive real ASR is out of scope here (S05's job).
 */
export interface ContentLocaleToTargetLang {
  toTargetLang(contentLocale: ContentLocale): string
}
