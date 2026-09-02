// Locale axis da matriz de visual regression (a de breakpoint vem dos 4 projects
// do playwright-ct.config.ts). Tuplo próprio, não import de packages/i18n: ui não
// depende de @limmiar/i18n. 'pseudo' é o 5º valor, só de teste (S00.5-04).
export const VISUAL_LOCALES = ['pt-BR', 'es-419', 'it-IT', 'en-US', 'pseudo'] as const

export type VisualLocale = (typeof VISUAL_LOCALES)[number]
