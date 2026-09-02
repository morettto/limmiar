import type { Locale } from './locale'

// Branded/opaque: a ContentLocale only ever comes from toContentLocale. With no
// encrypted flow in the repo yet, the brand is the guardrail available for D20 —
// it stops the UI's interface locale being reused as a content locale.
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
