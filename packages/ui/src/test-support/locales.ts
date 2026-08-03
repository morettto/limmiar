// Locale axis for the *.spec.tsx visual-regression matrix. Breakpoint
// coverage comes for free from playwright-ct.config.ts's 4 projects (each
// spec runs once per project); this array is the other axis.
//
// Deliberately its own literal tuple, not an import of packages/i18n's
// LOCALES/Locale — packages/ui has zero dependency on @limmiar/i18n
// (translation is the consuming app's job, not a presentation primitive's;
// see .dependency-cruiser.cjs). 'pseudo' (S00.5-04, ADR-S00.5-06) is this
// package's own test-only 5th axis value — named differently from
// apps/app's Lingui catalog folder 'pseudo-LOCALE' on purpose, so it reads
// as its own concept, not a reference to that gitignored, app-scoped build
// artifact. See test-support/pseudo-locale.ts for how fixture text derives
// its 'pseudo' entry.
export const VISUAL_LOCALES = ['pt-BR', 'es-419', 'it-IT', 'en-US', 'pseudo'] as const

export type VisualLocale = (typeof VISUAL_LOCALES)[number]
