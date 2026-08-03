// Locale axis for the *.spec.tsx visual-regression matrix. Breakpoint
// coverage comes for free from playwright-ct.config.ts's 4 projects (each
// spec runs once per project); this array is the other axis.
//
// S00.5-04 (pseudo-locale in the 7-primitives visual regression matrix)
// appends 'pseudo' here — nothing else in any *.spec.tsx needs to change.
export const VISUAL_LOCALES = ['pt-BR'] as const
