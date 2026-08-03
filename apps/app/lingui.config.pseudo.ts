import { defineConfig } from '@lingui/cli'
import baseConfig from './lingui.config'

// CI-only config (ADR-S00.5-06: pseudo-locale is a 5th "locale", never in
// production). Deliberately NOT merged into lingui.config.ts — that file
// drives the real app build (@lingui/vite-plugin reads it), and
// packages/i18n's `Locale` type only ever lists the 4 real locales, so
// nothing in application code can accidentally activate 'pseudo-LOCALE'
// even if this file's output sits on disk. Pseudolocalization itself is a
// native Lingui feature (no .po file needed for it — generated at compile
// time from the fallback locale's catalog).
export default defineConfig({
  ...baseConfig,
  locales: [...baseConfig.locales, 'pseudo-LOCALE'],
  // ADR-S00.5-06: "acrescenta acento e colchete delimitador" + ~35% text
  // expansion — accenting is the pseudolocalization library's own default
  // char substitution (no option needed); extend/prepend/append are the 3
  // knobs that need to be set explicitly to get the rest of that ADR.
  pseudoLocale: { locale: 'pseudo-LOCALE', extend: 0.35, prepend: '⟦', append: '⟧' },
  fallbackLocales: { 'pseudo-LOCALE': baseConfig.sourceLocale },
})
