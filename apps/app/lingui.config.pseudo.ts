import { defineConfig } from '@lingui/cli'
import baseConfig from './lingui.config'

// CI-only config (ADR-S00.5-06: pseudo-locale is a 5th "locale", never in production). Not merged
// into lingui.config.ts, which drives the real build, and packages/i18n's `Locale` lists only the 4
// real locales, so nothing in app code can activate this one.
export default defineConfig({
  ...baseConfig,
  locales: [...baseConfig.locales, 'pseudo-LOCALE'],
  // ADR-S00.5-06: acento, colchete delimitador e ~35% de expansão — o acento é o default da
  // biblioteca de pseudolocalização; extend/prepend/append são os três botões que é preciso
  // definir para obter o resto do ADR.
  pseudoLocale: { locale: 'pseudo-LOCALE', extend: 0.35, prepend: '⟦', append: '⟧' },
  fallbackLocales: { 'pseudo-LOCALE': baseConfig.sourceLocale },
})
